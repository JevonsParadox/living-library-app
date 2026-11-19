"use client";

// react-hooks/immutability flags THREE.js BufferAttribute mutations
// (`.needsUpdate = true`, `setX()`) when the attribute came from useMemo.
// THREE objects are mutate-and-flag by design — the standard R3F bridge
// for custom instanced attributes uses exactly this pattern. Disabled
// file-wide rather than scattering line-level directives that drift
// between rule firings.
/* eslint-disable react-hooks/immutability */

import { useRef, useMemo, useCallback, useEffect } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";
import { paintIntensity, displayScore01, ILLUMINATED_ALPHA, SELECTED_COLOR as SELECTED_HEX, SERIES_SIBLING_COLOR as SERIES_HEX, type BookPaintTier } from "@/lib/nebula/book-display";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";
import type { NbRegion, UserBookState } from "@/lib/nebula/nebula-types";

const BASE_RADIUS = 0.006;

const SELECTED_COLOR = new THREE.Color(SELECTED_HEX);
const SERIES_SIBLING_COLOR = new THREE.Color(SERIES_HEX);

/**
 * Compute a book's natural (un-selected, un-pulsed) appearance under the
 * three-tier paint model. The colour is the pure tier colour; the alpha
 * factor is written to a separate per-instance shader attribute so the
 * fresnel rim boost and the additive halo stack don't overwhelm dimming.
 */
/** Halo size multiplier on top of core scale. Background tier gets a
 *  tighter halo so 12k+ overlapping additive contributions don't accumulate
 *  into a bright wash at close zoom. Shelf + illuminated keep the full
 *  glow so they read as stars. */
const HALO_MUL_DEFAULT = 2.5;
const HALO_MUL_BACKGROUND = 1.6;

// D1 ignition + cascade timings (ms). Source book pulses 0–600ms; cascade
// starts at 300ms (during the source pulse so the two flow together) and
// runs until 1300ms with a 300ms per-book fade and a deterministic 0–300ms
// stagger from a bookId hash.
const IGNITION_SOURCE_MS = 600;
const IGNITION_PULSE_PEAK = 1.5;
const CASCADE_START_MS = 300;
const CASCADE_FADE_MS = 300;
const CASCADE_STAGGER_MS = 300;

/** Deterministic stagger per bookId. Char-sum mod CASCADE_STAGGER_MS so
 *  the same neighbour always fades on the same offset across re-renders
 *  (no jitter on retry). */
function staggerForBookId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % CASCADE_STAGGER_MS;
}

function bookPaint(
  book: NbBookWithCoords,
  libraryState: UserBookState | undefined,
  isIlluminated: boolean,
  isSeriesSibling: boolean,
  fogLevel: number,
): { color: THREE.Color; rimColor: THREE.Color; baseScale: number; alphaFactor: number; tier: BookPaintTier; haloMul: number } {
  const intensity = paintIntensity({
    libraryState,
    isIlluminated,
    isSeriesSibling,
    fogLevel,
  });
  const color = new THREE.Color(intensity.color);
  const rimColor = new THREE.Color(intensity.rimColor);
  const baseScale = BASE_RADIUS * (0.5 + displayScore01(book) * 1.5) * intensity.sizeFactor;
  const haloMul = intensity.tier === "background" ? HALO_MUL_BACKGROUND : HALO_MUL_DEFAULT;
  return { color, rimColor, baseScale, alphaFactor: intensity.alphaFactor, tier: intensity.tier, haloMul };
}

// Fresnel shader: dark centre, bright glowing edges, gated by per-instance
// alpha so dim tier books actually read as dim. Two per-instance colours:
// the built-in instanceColor sets the core (centre + emissive base), and
// the custom instanceRimColor attribute sets the rim. For most tiers they
// are identical; illuminated tier splits them (dark purple core + silver
// rim) so the outline reads against any backdrop.
const fresnelVertexShader = `
  attribute float instanceAlpha;
  attribute vec3 instanceRimColor;
  varying vec3 vInstanceColor;
  varying vec3 vInstanceRimColor;
  varying float vInstanceAlpha;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    #ifdef USE_INSTANCING_COLOR
      vInstanceColor = instanceColor;
    #else
      vInstanceColor = vec3(1.0);
    #endif
    vInstanceRimColor = instanceRimColor;
    vInstanceAlpha = instanceAlpha;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fresnelFragmentShader = `
  varying vec3 vInstanceColor;
  varying vec3 vInstanceRimColor;
  varying float vInstanceAlpha;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);

    // Dark core (25% of core colour) → bright rim (160% of rim colour).
    // Splitting core / rim sources lets illuminated books have a near-black
    // centre with a silver outline.
    vec3 coreFrag = vInstanceColor * 0.25;
    vec3 rimFrag = vInstanceRimColor * 1.6;
    vec3 color = mix(coreFrag, rimFrag, fresnel);

    // Subtle emissive base from the core colour so nothing is fully black.
    color += vInstanceColor * 0.08;

    // Final per-instance dimming. Applied AFTER all brightness math so a
    // book at alpha=0.30 truly renders at ~30% of its peak brightness.
    gl_FragColor = vec4(color * vInstanceAlpha, 1.0);
  }
`;

// Glow halo shader: additive light contribution per book, proportional to
// the per-instance alpha. Replaces the previous meshBasicMaterial whose
// fixed opacity treated every book identically — additive blending then
// stacked thousands of dim halos into a bright wash that hid the dim
// tier entirely. The 0.06 constant matches the previous baseline opacity.
const glowVertexShader = `
  attribute float instanceAlpha;
  varying vec3 vInstanceColor;
  varying float vInstanceAlpha;

  void main() {
    #ifdef USE_INSTANCING_COLOR
      vInstanceColor = instanceColor;
    #else
      vInstanceColor = vec3(1.0);
    #endif
    vInstanceAlpha = instanceAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const glowFragmentShader = `
  varying vec3 vInstanceColor;
  varying float vInstanceAlpha;

  void main() {
    // Squared alpha: with additive blending, 12k+ overlapping background
    // halos can otherwise pile into a bright wash at moderate zoom. Squaring
    // disproportionately suppresses dim contributions (0.15 → 0.0225 ≈ -85%)
    // while leaving shelf books at full strength (1.0² = 1.0).
    float gate = vInstanceAlpha * vInstanceAlpha;
    gl_FragColor = vec4(vInstanceColor * gate * 0.06, 1.0);
  }
`;

interface BookCloudProps {
  books: NbBookWithCoords[];
  regions: NbRegion[];
}

export function BookCloud({ books, regions }: BookCloudProps) {
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.InstancedMesh>(null);
  const { setSelectedBook, setHoveredBook, selectedBookId, hoveredBookId, isOnShelf, getBookState, selectedBook, userLibrary, spacingMultiplier, regionAnchorMap, illuminatedBookIds, ignitedBook, newlyIlluminatedRef, fogLevel } = useNebula();
  const highlightedSeriesId = selectedBook?.series_id ?? null;

  // bookId → index in `books` array. Lookups happen every frame during
  // active ignitions, so a Map beats books.findIndex.
  const bookIdToIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < books.length; i++) m.set(books[i].id, i);
    return m;
  }, [books]);

  // Fresnel shader material (memoized — created once)
  const fresnelMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: fresnelVertexShader,
      fragmentShader: fresnelFragmentShader,
      toneMapped: false,
    });
  }, []);

  // Glow halo material — additive blending, per-instance alpha gates the
  // contribution so dim books don't accumulate into a bright wash.
  const glowMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: glowVertexShader,
      fragmentShader: glowFragmentShader,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
  }, []);

  // Per-instance alpha attribute — one Float32 per book, attached to both
  // mesh geometries so each layer's shader sees the same dimming. THREE
  // objects are mutable by design (we call setX(i, value) and flip
  // needsUpdate on every shelf change), so the lint rules that flag
  // "modifying memoised values" / "ref access during render" don't fit
  // the pattern. Disabled locally; the pattern is the standard R3F bridge
  // for custom instanced attributes.
  const coreAlphaAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(books.length), 1),
    [books.length],
  );
  const glowAlphaAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(books.length), 1),
    [books.length],
  );
  // Rim-colour attribute on the core mesh only — halo material reads the
  // built-in instanceColor for its glow tint, leaving the outer halo
  // unchanged for illuminated books (still subtle dark-purple aura).
  const coreRimColorAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(books.length * 3), 3),
    [books.length],
  );

  // Attach the per-instance alpha attributes + rim colour once after mount
  // (or when books.length changes and the buffers are re-created).
  useEffect(() => {
    const core = coreRef.current;
    const glow = glowRef.current;
    if (core) {
      core.geometry.setAttribute("instanceAlpha", coreAlphaAttr);
      core.geometry.setAttribute("instanceRimColor", coreRimColorAttr);
    }
    if (glow) glow.geometry.setAttribute("instanceAlpha", glowAlphaAttr);
  }, [coreAlphaAttr, glowAlphaAttr, coreRimColorAttr]);

  // Set instance matrices and colours for both layers. Re-runs when the
  // shelf grows (userLibrary), illumination shifts (illuminatedBookIds), or
  // the selected/hovered series changes — bookPaint folds all three into
  // a single tier + colour + scale.
  useEffect(() => {
    const core = coreRef.current;
    const glow = glowRef.current;
    if (!core || !glow || books.length === 0) return;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      const libraryState = getBookState(book.id);
      const isSeriesSibling =
        highlightedSeriesId !== null &&
        book.series_id === highlightedSeriesId &&
        book.id !== selectedBookId;
      const isIlluminated = illuminatedBookIds.has(book.id);

      const { color, rimColor, baseScale, alphaFactor, haloMul } = bookPaint(book, libraryState, isIlluminated, isSeriesSibling, fogLevel.get(book.id) ?? 0);

      // Series sibling override: amber tint wins over the natural tier colour
      // so the focused series spine reads at a glance. Rim follows the core
      // for siblings — no rim differentiation while a series is highlighted.
      if (isSeriesSibling) {
        color.copy(SERIES_SIBLING_COLOR);
        rimColor.copy(SERIES_SIBLING_COLOR);
      }

      const [px, py, pz] = bookWorldPos(book, regionAnchorMap, spacingMultiplier);
      dummy.position.set(px, py, pz);
      dummy.scale.setScalar(baseScale);
      dummy.updateMatrix();
      core.setMatrixAt(i, dummy.matrix);

      // Glow halo — tier-aware so background books don't accumulate a wash.
      dummy.scale.setScalar(baseScale * haloMul);
      dummy.updateMatrix();
      glow.setMatrixAt(i, dummy.matrix);

      core.setColorAt(i, color);
      glow.setColorAt(i, color);
      coreAlphaAttr.setX(i, alphaFactor);
      glowAlphaAttr.setX(i, alphaFactor);
      coreRimColorAttr.setXYZ(i, rimColor.r, rimColor.g, rimColor.b);
    }

    core.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    // THREE buffer attributes are designed to be flagged dirty after writes;
    // the lint rule treats useMemo'd values as immutable but the THREE API
    // is mutate-and-flag.
    coreAlphaAttr.needsUpdate = true;
    glowAlphaAttr.needsUpdate = true;
    coreRimColorAttr.needsUpdate = true;
    core.computeBoundingBox();
    core.computeBoundingSphere();
  }, [books, userLibrary, illuminatedBookIds, highlightedSeriesId, selectedBookId, isOnShelf, getBookState, regionAnchorMap, spacingMultiplier, coreAlphaAttr, glowAlphaAttr, coreRimColorAttr, fogLevel]);

  // Track previous active index
  const prevActiveIdx = useRef<number>(-1);

  // Animate: twinkle + pulse selected/hovered
  useFrame(({ clock }) => {
    const core = coreRef.current;
    const glow = glowRef.current;
    if (!core || !glow) return;

    const time = clock.getElapsedTime();
    const dummy = new THREE.Object3D();
    const activeId = selectedBookId ?? hoveredBookId;
    const idx = activeId ? books.findIndex((b) => b.id === activeId) : -1;

    // Restore previous selection to its tier-derived appearance.
    if (prevActiveIdx.current !== -1 && prevActiveIdx.current !== idx) {
      const prev = books[prevActiveIdx.current];
      if (prev) {
        const prevState = getBookState(prev.id);
        const prevIsIll = illuminatedBookIds.has(prev.id);
        const prevIsSibling =
          highlightedSeriesId !== null &&
          prev.series_id === highlightedSeriesId &&
          prev.id !== selectedBookId;
        const { color: c, rimColor: rc, baseScale: s, alphaFactor: a, haloMul: hm } = bookPaint(prev, prevState, prevIsIll, prevIsSibling, fogLevel.get(prev.id) ?? 0);
        if (prevIsSibling) {
          c.copy(SERIES_SIBLING_COLOR);
          rc.copy(SERIES_SIBLING_COLOR);
        }
        core.setColorAt(prevActiveIdx.current, c);
        glow.setColorAt(prevActiveIdx.current, c);
        coreAlphaAttr.setX(prevActiveIdx.current, a);
        glowAlphaAttr.setX(prevActiveIdx.current, a);
        coreRimColorAttr.setXYZ(prevActiveIdx.current, rc.r, rc.g, rc.b);
        const [ppx, ppy, ppz] = bookWorldPos(prev, regionAnchorMap, spacingMultiplier);
        dummy.position.set(ppx, ppy, ppz);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        core.setMatrixAt(prevActiveIdx.current, dummy.matrix);
        dummy.scale.setScalar(s * hm);
        dummy.updateMatrix();
        glow.setMatrixAt(prevActiveIdx.current, dummy.matrix);
      }
    }

    // Twinkle: subtle scale oscillation for 20 random books each frame.
    // Full twinkle of all 12k+ instances every frame would torch the GPU.
    for (let t = 0; t < 20; t++) {
      const ti = Math.floor((time * 100 + t * 223) % books.length);
      if (ti === idx || ti === prevActiveIdx.current) continue;
      const tb = books[ti];
      const tbState = getBookState(tb.id);
      const isSibling =
        highlightedSeriesId !== null &&
        tb.series_id === highlightedSeriesId &&
        tb.id !== selectedBookId;
      const isIll = illuminatedBookIds.has(tb.id);
      const { baseScale: baseS, haloMul: hm } = bookPaint(tb, tbState, isIll, isSibling, fogLevel.get(tb.id) ?? 0);
      // Reading books pulse slowly (continuous heartbeat); others get a subtle twinkle.
      const isReading = tbState?.status === "reading" && tbState.ownership === "owned";
      const twinkle = isReading
        ? 1 + 0.18 * Math.sin(time * 1.4 + ti * 0.3)
        : 1 + 0.08 * Math.sin(time * 1.5 + ti * 0.7);
      const [tpx, tpy, tpz] = bookWorldPos(tb, regionAnchorMap, spacingMultiplier);
      dummy.position.set(tpx, tpy, tpz);
      dummy.scale.setScalar(baseS * twinkle);
      dummy.updateMatrix();
      core.setMatrixAt(ti, dummy.matrix);
      dummy.scale.setScalar(baseS * twinkle * hm);
      dummy.updateMatrix();
      glow.setMatrixAt(ti, dummy.matrix);
    }

    // ----- D1 Ignition: source pulse + cascade through new neighbours -----
    //
    // Both phases gated by `ignitedBook.at` being set and within the active
    // window. Outside that window, useEffect's natural-tier paint reasserts.
    if (ignitedBook.bookId && ignitedBook.at != null) {
      const ignElapsed = Date.now() - ignitedBook.at;

      // Source pulse: eases up to IGNITION_PULSE_PEAK at midpoint, fades
      // to 1.0 by IGNITION_SOURCE_MS.
      if (ignElapsed >= 0 && ignElapsed < IGNITION_SOURCE_MS) {
        const sIdx = bookIdToIndex.get(ignitedBook.bookId);
        if (sIdx != null) {
          const t = ignElapsed / IGNITION_SOURCE_MS;
          const pulseAmount = (1 - t) * Math.sin(Math.PI * t);
          const sBook = books[sIdx];
          const sState = getBookState(sBook.id);
          const sIsIll = illuminatedBookIds.has(sBook.id);
          const sIsSibling =
            highlightedSeriesId !== null &&
            sBook.series_id === highlightedSeriesId &&
            sBook.id !== selectedBookId;
          const { baseScale: sb, haloMul: shm } = bookPaint(sBook, sState, sIsIll, sIsSibling, fogLevel.get(sBook.id) ?? 0);
          const pulseMul = 1 + (IGNITION_PULSE_PEAK - 1) * pulseAmount;
          const [sx, sy, sz] = bookWorldPos(sBook, regionAnchorMap, spacingMultiplier);
          dummy.position.set(sx, sy, sz);
          dummy.scale.setScalar(sb * pulseMul);
          dummy.updateMatrix();
          core.setMatrixAt(sIdx, dummy.matrix);
          dummy.scale.setScalar(sb * pulseMul * shm);
          dummy.updateMatrix();
          glow.setMatrixAt(sIdx, dummy.matrix);
          // Force full alpha so the pulse reads at peak brightness.
          coreAlphaAttr.setX(sIdx, 1.0);
          glowAlphaAttr.setX(sIdx, 1.0);
        }
      }

      // Cascade: fade in the books that *newly* became illuminated by this
      // add. Each starts at CASCADE_START_MS + its own stagger and fades
      // alpha 0 → ILLUMINATED_ALPHA over CASCADE_FADE_MS. Runs from t=0
      // so we hide the neighbours from the start (useEffect's natural
      // illuminated alpha would otherwise make them visible immediately).
      const cascadeWindowEnd = CASCADE_START_MS + CASCADE_STAGGER_MS + CASCADE_FADE_MS;
      if (ignElapsed >= 0 && ignElapsed < cascadeWindowEnd) {
        for (const nId of newlyIlluminatedRef.current) {
          const nIdx = bookIdToIndex.get(nId);
          if (nIdx == null) continue;
          const stagger = staggerForBookId(nId);
          const cascadeElapsed = ignElapsed - CASCADE_START_MS - stagger;
          if (cascadeElapsed < 0) {
            // Before this neighbour's turn — fully transparent.
            coreAlphaAttr.setX(nIdx, 0);
            glowAlphaAttr.setX(nIdx, 0);
            continue;
          }
          if (cascadeElapsed >= CASCADE_FADE_MS) continue; // settled; useEffect's value reasserts
          const t = cascadeElapsed / CASCADE_FADE_MS;
          const fadeAlpha = ILLUMINATED_ALPHA * t;
          coreAlphaAttr.setX(nIdx, fadeAlpha);
          glowAlphaAttr.setX(nIdx, fadeAlpha);
        }
      }
    }
    // ---------------------------------------------------------------------

    if (idx === -1) {
      if (prevActiveIdx.current !== -1) {
        core.instanceMatrix.needsUpdate = true;
        glow.instanceMatrix.needsUpdate = true;
        if (core.instanceColor) core.instanceColor.needsUpdate = true;
        if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
        coreAlphaAttr.needsUpdate = true;
        glowAlphaAttr.needsUpdate = true;
        coreRimColorAttr.needsUpdate = true;
        prevActiveIdx.current = -1;
      } else {
        core.instanceMatrix.needsUpdate = true;
        glow.instanceMatrix.needsUpdate = true;
        coreAlphaAttr.needsUpdate = true;
        glowAlphaAttr.needsUpdate = true;
      }
      return;
    }

    const book = books[idx];
    const inLibrary = isOnShelf(book.id);
    const baseScale = BASE_RADIUS * (0.5 + displayScore01(book) * 1.5);
    const pulse = 1 + 0.4 * Math.sin(time * 5);

    const [spx, spy, spz] = bookWorldPos(book, regionAnchorMap, spacingMultiplier);
    dummy.position.set(spx, spy, spz);
    dummy.scale.setScalar(baseScale * pulse * (inLibrary ? 3.0 : 2.5));
    dummy.updateMatrix();
    core.setMatrixAt(idx, dummy.matrix);
    dummy.scale.setScalar(baseScale * pulse * (inLibrary ? 3.0 : 2.5) * 3);
    dummy.updateMatrix();
    glow.setMatrixAt(idx, dummy.matrix);

    core.setColorAt(idx, SELECTED_COLOR);
    glow.setColorAt(idx, SELECTED_COLOR);
    // Selected/hovered books always render at full alpha so the white
    // pulse reads regardless of the book's natural tier. Rim also forced
    // to white so an illuminated book under selection doesn't show a
    // silver rim through the white pulse.
    coreAlphaAttr.setX(idx, 1.0);
    glowAlphaAttr.setX(idx, 1.0);
    coreRimColorAttr.setXYZ(idx, SELECTED_COLOR.r, SELECTED_COLOR.g, SELECTED_COLOR.b);

    core.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    coreAlphaAttr.needsUpdate = true;
    glowAlphaAttr.needsUpdate = true;
    coreRimColorAttr.needsUpdate = true;
    prevActiveIdx.current = idx;
  });

  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && e.instanceId < books.length) {
        setHoveredBook(books[e.instanceId].id);
        document.body.style.cursor = "pointer";
      }
    },
    [books, setHoveredBook]
  );

  const handlePointerOut = useCallback(() => {
    setHoveredBook(null);
    document.body.style.cursor = "auto";
  }, [setHoveredBook]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && e.instanceId < books.length) {
        const bookId = books[e.instanceId].id;
        setSelectedBook(selectedBookId === bookId ? null : bookId);
      }
    },
    [books, setSelectedBook, selectedBookId]
  );

  if (books.length === 0) return null;

  return (
    <group>
      {/* Layer 2: Glow halo (rendered first, behind core) */}
      <instancedMesh
        ref={glowRef}
        args={[undefined, undefined, books.length]}
        material={glowMaterial}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 12, 8]} />
      </instancedMesh>

      {/* Layer 1: Core sphere with fresnel shader (interactive) */}
      <instancedMesh
        ref={coreRef}
        args={[undefined, undefined, books.length]}
        material={fresnelMaterial}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[1, 16, 12]} />
      </instancedMesh>
    </group>
  );
}
