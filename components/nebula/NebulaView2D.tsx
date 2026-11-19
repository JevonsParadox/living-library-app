"use client";

/**
 * Force-directed 2D graph rendering of the Nebula catalog. Mounted by the
 * NebulaView orchestrator when viewMode === "2d".
 *
 * Subscribes to NebulaContext for the same data the 3D scene uses, so the
 * BookDetailPanel, search, library highlighting and Add-to-Universe flows
 * all work without modification.
 *
 * Performance notes for 12,785 nodes:
 *   - Initial positions seeded from bookWorldPos(x, y) so the first frame
 *     already shows the catalog clustered by region rather than a soup.
 *   - cooldownTicks=300 + d3AlphaDecay=0.04 settles in ~3 sec then freezes.
 *   - We re-heat (alphaTarget bump) only when books are appended via
 *     addBookToGalaxy.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNebula } from "@/lib/nebula/nebula-context";
import { BASE_WORLD_SCALE } from "@/lib/nebula/world-scale";
import { paintIntensity, displayScore01, regionPlanetIntensity, ILLUMINATED_ALPHA, EMPTY_REGION_COLOR } from "@/lib/nebula/book-display";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";
import type { UserBookState } from "@/lib/nebula/nebula-types";

// Dynamically imported because the lib touches `window` / canvas; SSR-safe.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => null,
});

// ---------- Graph data shape ----------
//
// Two node kinds share the simulation:
//   - "book": one per row in `books`. Free to drift; pulled by regionGravity
//             toward its home region and by series links toward its mates.
//   - "region": one per row in `regions`. Pinned at its 2D anchor via fx/fy
//               so the planet is the visible centre of its cluster. Dragging
//               temporarily un-pins (the lib overrides fx/fy during drag);
//               onNodeDragEnd re-pins to the anchor for snap-back.
//
// Region ids are namespaced (`region:<id>`) so they never collide with book
// ids in lookups and click handlers can branch with one check.

interface BookNode {
  kind: "book";
  id: string;
  title: string;
  authorName: string | null;
  /** Region color in #rrggbb; used as the default node color. */
  regionColor: string;
  /** Source data for color/size derivation. */
  popularity_score: number;
  engagement_score: number;
  series_id: string | null;
  // d3-force will mutate these:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

interface RegionNode {
  kind: "region";
  /** Namespaced id, e.g. `region:macro_sf_hard`, so it cannot collide with book ids. */
  id: string;
  /** Bare region id, used to flyTo the region and look up colour/anchor. */
  regionId: string;
  name: string;
  /** #rrggbb hex from `nb_regions.color_hex`. */
  regionColor: string;
  /** Number of books currently assigned to this region — used for sizing. */
  memberCount: number;
  // Pinned position. Set on creation; restored in onNodeDragEnd.
  fx: number;
  fy: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

type GraphNode = BookNode | RegionNode;

interface GraphLink {
  source: string;
  target: string;
}

// ---------- Visual constants ----------

const BG_COLOR = "#05070A";
/** Multiplier applied to bookWorldPos when seeding canvas positions; lifts
 *  the world coords into a pleasingly readable canvas range. Used by both
 *  data adapter and region-anchor projection so they stay consistent. */
const GRAPH_SCALE = 200;
/** Map displayScore01 [0,1] → node radius. The big-name books pop without
 *  the long-tail looking like dust. */
const NODE_RADIUS_MIN = 1.4;
const NODE_RADIUS_MAX = 6.0;
/** Halo (size of the click-target relative to the radius). */
const NODE_HIT_RADIUS_FACTOR = 1.8;
/** Series edges (default): subtle so the catalog doesn't read like a tangle. */
const LINK_COLOR = "rgba(255, 255, 255, 0.07)";
/** Series edges (selected series): amber, matching the series-sibling
 *  colour so the spine of the focused series reads at a glance. */
const LINK_COLOR_HIGHLIGHTED = "rgba(245, 158, 11, 0.85)";
const LINK_WIDTH = 0.6;
const LINK_WIDTH_HIGHLIGHTED = 1.6;
/** Title labels appear when canvas zoom is above this — Obsidian-ish. */
const LABEL_ZOOM_THRESHOLD = 3.0;
/** Region label visibility curve: full opacity below this zoom, faded above. */
const REGION_LABEL_FADE_START = 1.5;
const REGION_LABEL_FADE_END = 4.0;
/** d3-force strength for pulling each book toward its region planet's live
 *  position. With visible region planets (E.7.1) acting as the cluster
 *  centre, a stronger pull reads as "books belong to this body" — the
 *  cluster looks bound rather than smeared. Was 0.05 (no planets) → 0.10
 *  (post-drag elasticity) → 0.20 (planet-as-gravitational-centre). */
const REGION_GRAVITY_STRENGTH = 0.2;
/** Region planet sizing. sqrt(memberCount) keeps the visual area roughly
 *  proportional to member count without the largest regions dominating.
 *  MIN keeps tiny regions visible; MAX prevents the densest regions from
 *  overwhelming the canvas at low zoom. */
const PLANET_RADIUS_MIN = 20;
const PLANET_RADIUS_MAX = 80;
const PLANET_RADIUS_SQRT_COEFF = 1.2;
/** Planet halo: a soft outer glow at low alpha that gives the disc body a
 *  sense of light without competing with book glow. */
const PLANET_HALO_RADIUS_FACTOR = 1.5;
// D2 region awakening flash — matches RegionPlanets.tsx in 3D so a flash
// triggered by adding a book reads identically across modes.
const FLASH_DURATION_MS = 1000;
const FLASH_PLANET_PEAK = 1.2;
const FLASH_HALO_PEAK = 3.0;
// Color-lerp during the flash: ramp grey → region color across the first
// ~67% of the flash window, then hold. Matches 3D RegionPlanets.tsx.
const COLOR_LERP_FRACTION = 0.67;

/**
 * Linear-interpolate two hex colors (e.g. "#3A3F47" → "#3B82F6") to a third
 * hex. Cheap enough to call from paintNode every frame for our 14 region
 * planets — no measurable hit. Inputs assumed valid 6-digit hex (with `#`).
 */
function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bx = Math.round(ab + (bb - ab) * t);
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    bx.toString(16).padStart(2, "0")
  );
}

// D1 ignition + cascade — matches BookCloud.tsx so the same animation
// reads identically across 3D and 2D.
const IGNITION_SOURCE_MS = 600;
const IGNITION_PULSE_PEAK = 1.5;
const CASCADE_START_MS = 300;
const CASCADE_FADE_MS = 300;
const CASCADE_STAGGER_MS = 300;

function staggerForBookId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % CASCADE_STAGGER_MS;
}
/** Search / deep-link fly-to: zoom level the canvas snaps to and animation
 *  duration in ms. 4 puts us comfortably past LABEL_ZOOM_THRESHOLD so the
 *  target book shows its title once the camera lands. */
const FLY_ZOOM = 4;
/** Zoom level when flying to a region — wide enough to show the cluster but
 *  below REGION_LABEL_FADE_END so the planet label still reads. */
const FLY_ZOOM_REGION = 1.2;
/** Overview zoom when un-focusing a region (toggle via re-clicking the
 *  same planet, which sets flyTarget to HOME_TARGET = origin). */
const FLY_ZOOM_HOME = 0.4;
const FLY_DURATION_MS = 700;
/** Similar-reads beams: cyan-on-dark, matching 3D's SimilarReadsEdges colour
 *  (#38BDF8). Translucent so they read as rays rather than competing with
 *  the series spine for attention. */
const SIMILAR_EDGE_COLOR = "rgba(56, 189, 248, 0.55)";
const SIMILAR_EDGE_WIDTH = 1.4;
/** Reading-path trail: gold (#FFD700) matching 3D's NebulaPathLine. The
 *  underlay glow at low alpha makes the line read as luminous against the
 *  dark canvas without overwhelming nearby nodes. */
const PATH_CORE_COLOR = "rgba(255, 215, 0, 0.85)";
const PATH_GLOW_COLOR = "rgba(255, 215, 0, 0.18)";
const PATH_CORE_WIDTH = 1.6;
const PATH_GLOW_WIDTH = 5;

// ---------- 2D positioning helper ----------
//
// 2D uses a single uniform scale for both planets and books, instead of
// 3D's bookWorldPos formula (which keeps books tightly clustered around
// their region anchor as the spacingMultiplier slider grows). The 3D math
// would leave planets at `anchor × BASE × GRAPH_SCALE` while books spread
// to `multiplier ×` further from origin — meaning at multiplier=4 the
// planets clump in the inner ~25% of the auto-fit view while books fill
// the outer 75%. With visible planets in 2D, that mismatch read as
// "regions are clumped in the middle of a vast empty universe."
//
// Using one uniform scale here, books still cluster around their planet
// because their semantic coords are *already* near their region's anchor
// (that's how the seeding pipeline placed them). The regionGravity force
// then tightens the cluster around the planet at runtime.
function pos2D(x: number, y: number, multiplier: number): [number, number] {
  const k = BASE_WORLD_SCALE * multiplier * GRAPH_SCALE;
  return [x * k, y * k];
}

// ---------- Component ----------

export function NebulaView2D() {
  const {
    books, regions, spacingMultiplier,
    selectedBookId, hoveredBookId,
    setSelectedBook, setHoveredBook,
    getBookState,
    selectedBook,
    flyTarget,
    similarBookIds,
    showPath, sortedPath,
    flyToRegion, focusedRegionId,
    illuminatedBookIds, regionShelfCounts,
    awakenedRegion,
    ignitedBook, newlyIlluminatedRef,
    userLibrary,
    recentShelfBooks,
    fogLevel,
    illuminationMap,
  } = useNebula();

  const containerRef = useRef<HTMLDivElement>(null);
  // Disable the size hook's setter return so its identity stays referentially
  // simple for downstream effects. We only read.
  const [size] = useObserveSize(containerRef);

  // Ref to the ForceGraph2D instance so we can attach a custom force after
  // mount and re-heat the simulation when book set / region map changes.
  // The library doesn't ship typed instance methods publicly; cast minimally.
  type FgInstance = {
    d3Force: (name: string, force: D3ForceFn | null) => FgInstance;
    d3ReheatSimulation: () => void;
    centerAt: (x: number, y: number, ms?: number) => FgInstance;
    zoom: (k: number, ms?: number) => FgInstance;
  };
  const fgRef = useRef<FgInstance | null>(null);

  // Region color lookup — the default node color before library-state
  // overrides kick in.
  const regionColorMap = useMemo(
    () => new Map(regions.map((r) => [r.id, r.color_hex ?? "#8B9DC3"])),
    [regions],
  );

  // Project each region's anchor into 2D canvas space using the same uniform
  // scale as the book nodes (see pos2D). Used for drag-end snap-back so the
  // planet returns exactly to where graphData seeded it.
  const region2DAnchorMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number; name: string }>();
    for (const r of regions) {
      const [x, y] = pos2D(r.anchor_x, r.anchor_y, spacingMultiplier);
      m.set(r.id, { x, y, name: r.name });
    }
    return m;
  }, [regions, spacingMultiplier]);

  // node.id → region.id lookup for fast access inside the force callback
  // and inside onRenderFramePost (which fires every frame).
  const nodeRegionMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of books) {
      if (b.region_id) m.set(b.id, b.region_id);
    }
    return m;
  }, [books]);

  // Build the graph data. Re-derive only when the book set itself changes —
  // not on every selection / hover (that would discard d3's settled positions).
  const graphData = useMemo(() => {
    // Member counts per region — used to size the region planets in E.7.3.
    const regionMemberCounts = new Map<string, number>();
    for (const b of books) {
      if (!b.region_id) continue;
      regionMemberCounts.set(b.region_id, (regionMemberCounts.get(b.region_id) ?? 0) + 1);
    }

    // Region planets: one per region, pinned at its 2D anchor. Prepended to
    // the array so they paint first (backdrop) and books overlay on top.
    const regionNodes: RegionNode[] = regions.map((r) => {
      const [x, y] = pos2D(r.anchor_x, r.anchor_y, spacingMultiplier);
      return {
        kind: "region",
        id: `region:${r.id}`,
        regionId: r.id,
        name: r.name,
        regionColor: r.color_hex ?? "#8B9DC3",
        memberCount: regionMemberCounts.get(r.id) ?? 0,
        fx: x,
        fy: y,
        x,
        y,
      };
    });

    const bookNodes: BookNode[] = books.map((b) => {
      const [x, y] = pos2D(b.x, b.y, spacingMultiplier);
      return {
        kind: "book",
        id: b.id,
        title: b.title,
        authorName: b.author_name ?? null,
        regionColor: b.region_id ? regionColorMap.get(b.region_id) ?? "#8B9DC3" : "#8B9DC3",
        popularity_score: b.popularity_score,
        engagement_score: b.engagement_score ?? 0,
        series_id: b.series_id ?? null,
        x,
        y,
      };
    });

    // Series edges: connect consecutive books by series_order, same logic as
    // 3D's SeriesEdges component.
    const links: GraphLink[] = [];
    const groups = new Map<string, NbBookWithCoords[]>();
    for (const b of books) {
      if (!b.series_id) continue;
      const g = groups.get(b.series_id) ?? [];
      g.push(b);
      groups.set(b.series_id, g);
    }
    for (const [, sBooks] of groups) {
      if (sBooks.length < 2) continue;
      sBooks.sort((a, b) => (a.series_order ?? 999) - (b.series_order ?? 999));
      for (let i = 0; i < sBooks.length - 1; i++) {
        links.push({ source: sBooks[i].id, target: sBooks[i + 1].id });
      }
    }
    return { nodes: [...regionNodes, ...bookNodes], links };
    // spacingMultiplier intentionally excluded — re-running the simulation
    // every time the (3D) slider changes would be jarring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, regions, regionColorMap]);

  // Stable id → book-node lookup for overlay drawing. Force-graph mutates
  // node.x/.y in place so the references stay valid across frames; we only
  // rebuild this when the book set itself changes. Region nodes are filtered
  // out — every consumer of this map (drawReadingPath, drawSimilarEdges,
  // flyTo effect) keys by bare book id, not the namespaced region id.
  const nodeById = useMemo(() => {
    const m = new Map<string, BookNode>();
    for (const n of graphData.nodes) {
      if (n.kind === "book") m.set(n.id, n);
    }
    return m;
  }, [graphData.nodes]);

  // Highlight the selected book's series so a click adds context, mirroring
  // 3D's SelectedSeriesEdges behaviour.
  const highlightedSeriesId = selectedBook?.series_id ?? null;

  // Search and deep links call flyToBook in context, which sets `flyTarget`
  // for the 3D camera. In 2D we react to the same signal and pan/zoom the
  // canvas imperatively. This keeps the search UX consistent across modes
  // without NebulaSearch knowing anything about render mode.
  //
  // We track the most recently handled flyTarget by reference so that
  // toggling between modes doesn't replay an already-handled fly. The first
  // non-null flyTarget after mount will trigger correctly.
  const lastHandledFlyTarget = useRef<typeof flyTarget>(null);
  useEffect(() => {
    if (!flyTarget) return;
    if (flyTarget === lastHandledFlyTarget.current) return;
    lastHandledFlyTarget.current = flyTarget;

    const fg = fgRef.current;
    if (!fg) return;

    // The d3 simulation mutates node.x/.y from the seeded position. Pick
    // the destination based on what was set with flyTarget:
    //   1. Region focus (clicked a planet): use that planet's pinned 2D
    //      anchor — flyTarget's 3D world coord doesn't translate directly
    //      to the new uniform-scale 2D canvas.
    //   2. Selected book (clicked a book or search result): use the live
    //      node position so the camera lands where d3 settled the node,
    //      not where it was seeded.
    //   3. Race fallback (book just added, node not in sim yet): compute
    //      pos2D from the book record so the camera still lands correctly.
    let cx: number | undefined;
    let cy: number | undefined;
    if (focusedRegionId) {
      const anchor = region2DAnchorMap.get(focusedRegionId);
      if (anchor) {
        cx = anchor.x;
        cy = anchor.y;
      }
    } else if (selectedBookId) {
      const liveNode = nodeById.get(selectedBookId);
      cx = liveNode?.x;
      cy = liveNode?.y;
      if (cx == null || cy == null) {
        const book = books.find((b) => b.id === selectedBookId);
        if (book) [cx, cy] = pos2D(book.x, book.y, spacingMultiplier);
      }
    }
    if (cx == null || cy == null) {
      cx = flyTarget.x * GRAPH_SCALE;
      cy = flyTarget.y * GRAPH_SCALE;
    }
    // Pick zoom level by intent: region-cluster wide / home overview / book close.
    const zoom = focusedRegionId
      ? FLY_ZOOM_REGION
      : !selectedBookId && flyTarget.x === 0 && flyTarget.y === 0
        ? FLY_ZOOM_HOME
        : FLY_ZOOM;
    fg.centerAt(cx, cy, FLY_DURATION_MS);
    fg.zoom(zoom, FLY_DURATION_MS);
  }, [flyTarget, selectedBookId, focusedRegionId, region2DAnchorMap, nodeById, books, spacingMultiplier]);

  // Custom d3-force: pull each book toward its region planet's *live* x/y.
  // Reading the planet's current position (instead of the static anchor)
  // means a drag carries the cluster — books get nudged toward wherever the
  // planet has been pulled, and on release the planet snaps back to its
  // anchor and the books trail home with it.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const force = makeRegionGravityForce(nodeRegionMap, REGION_GRAVITY_STRENGTH);
    fg.d3Force("regionGravity", force);
    fg.d3ReheatSimulation();

    return () => {
      // Detach when book set / regions change — the new useEffect run
      // re-attaches with fresh closures.
      fgRef.current?.d3Force("regionGravity", null);
    };
  }, [nodeRegionMap]);

  // Custom node painter. Drawn every frame, so kept tight.
  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (node.kind === "region") {
        // Region planet: halo + translucent disc + rim, sized by member
        // count via sqrt scaling. Drawn first (region nodes prepended in
        // graphData) so book nodes layer on top. Always-on label centred on
        // the planet, fading out as the user zooms close — at star-level
        // zoom the label disappears so individual book titles can read.
        const x = node.x ?? node.fx;
        const y = node.y ?? node.fy;
        const radius = Math.min(
          PLANET_RADIUS_MAX,
          PLANET_RADIUS_MIN + Math.sqrt(node.memberCount) * PLANET_RADIUS_SQRT_COEFF,
        );

        // D4: planet brightness scales with how many books from this region
        // are on the user's shelf. Empty regions render at floor intensity;
        // 30+ books hit 100%.
        const shelfCount = regionShelfCounts.get(node.regionId) ?? 0;
        const planetIntensity = regionPlanetIntensity({ shelfCount });

        // D2: brief flash when this region's shelf count went 0→N. Same
        // curve as 3D RegionPlanets — `(1 - t) * sin(π·t)` peaks past
        // midpoint, fades to zero by FLASH_DURATION_MS. paintNode runs
        // every frame at canvas refresh rate, so the animation is smooth.
        // colorProgress is a separate curve: 0 = full grey, 1 = full
        // region colour. Ramps linearly across the first 67% of the flash
        // then holds — colour "fills in" before the pulse fades.
        let flashAmount = 0;
        let colorProgress = shelfCount > 0 ? 1 : 0;
        if (
          awakenedRegion.regionId === node.regionId &&
          awakenedRegion.at != null
        ) {
          const elapsed = Date.now() - awakenedRegion.at;
          if (elapsed >= 0 && elapsed < FLASH_DURATION_MS) {
            const t = elapsed / FLASH_DURATION_MS;
            flashAmount = (1 - t) * Math.sin(Math.PI * t);
            colorProgress = Math.min(1, t / COLOR_LERP_FRACTION);
          }
        }
        const flashRadiusMul = 1 + (FLASH_PLANET_PEAK - 1) * flashAmount;
        const flashOpacityMul = 1 + (FLASH_HALO_PEAK - 1) * flashAmount;

        // Effective colour at this frame — grey when empty, region's real
        // colour when populated, lerping between during the awakening flash.
        const planetColor =
          colorProgress >= 1
            ? node.regionColor
            : colorProgress <= 0
              ? EMPTY_REGION_COLOR
              : lerpHex(EMPTY_REGION_COLOR, node.regionColor, colorProgress);

        ctx.save();
        ctx.globalAlpha = planetIntensity.alphaFactor * flashOpacityMul;

        // Halo (largest, lowest alpha — soft outer glow). Flat fill at low
        // alpha; the radial gradient lives on the disc body below.
        ctx.beginPath();
        ctx.arc(
          x,
          y,
          radius * PLANET_HALO_RADIUS_FACTOR * planetIntensity.haloFactor * flashRadiusMul,
          0,
          2 * Math.PI,
          false,
        );
        ctx.fillStyle = planetColor + "11"; // ~7% alpha
        ctx.fill();

        // Disc body — radial gradient gives the orb a sense of depth:
        // brighter centre, softer edge. Mirrors the 3D fresnel shader
        // intent in flat canvas-land.
        const discRadius = radius * flashRadiusMul;
        const discGrad = ctx.createRadialGradient(x, y, 0, x, y, discRadius);
        discGrad.addColorStop(0, planetColor + "55");   // ~33% alpha at centre
        discGrad.addColorStop(0.6, planetColor + "2A"); // ~16% mid (extends the "lit" core)
        discGrad.addColorStop(1, planetColor + "0A");   // ~4% at the edge, soft fade
        ctx.beginPath();
        ctx.arc(x, y, discRadius, 0, 2 * Math.PI, false);
        ctx.fillStyle = discGrad;
        ctx.fill();

        // Rim — half-alpha stroke gives a clean silhouette edge.
        ctx.strokeStyle = planetColor + "88"; // ~53% alpha
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.restore();

        // Always-on label, fading by zoom (Obsidian-style "groups visible
        // at overview, fade as you focus on individual nodes"). Drawn
        // outside the save/restore so the label stays readable regardless
        // of the planet's engagement-driven dimming.
        // Floor at 0.4 so region labels remain readable at every zoom level —
        // they're navigational landmarks, not detail-zoom adornments.
        const fade =
          globalScale < REGION_LABEL_FADE_START
            ? 1
            : globalScale > REGION_LABEL_FADE_END
              ? 0
              : 1 -
                (globalScale - REGION_LABEL_FADE_START) /
                  (REGION_LABEL_FADE_END - REGION_LABEL_FADE_START);
        const labelOpacity = 0.4 + 0.6 * fade;
        if (labelOpacity > 0.01) {
          const fontSize = Math.max(11, radius * 0.34);
          ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
          ctx.shadowBlur = 6;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * labelOpacity})`;
          ctx.fillText(node.name.toUpperCase(), x, y);
          ctx.shadowBlur = 0;
        }
        return;
      }

      const isSelected = node.id === selectedBookId;
      const isHovered = node.id === hoveredBookId;
      const isSeriesSibling =
        highlightedSeriesId !== null &&
        node.series_id === highlightedSeriesId &&
        node.id !== selectedBookId;
      const libState: UserBookState | undefined = getBookState(node.id);
      const isIlluminated = illuminatedBookIds.has(node.id);

      const intensity = paintIntensity({
        libraryState: libState,
        isIlluminated,
        regionColor: node.regionColor,
        isSelected,
        isSeriesSibling,
        fogLevel: fogLevel.get(node.id) ?? 0,
      });

      const score = displayScore01(node);
      const baseR = NODE_RADIUS_MIN + score * (NODE_RADIUS_MAX - NODE_RADIUS_MIN);
      // Tier sizeFactor sets the structural size; selection/hover apply an
      // additional contextual bump on top so an active background book is
      // still visibly larger than its neighbours.
      let r = baseR * intensity.sizeFactor * (isSelected ? 1.6 : isHovered ? 1.2 : 1.0);

      // D1 ignition + cascade — same curves and timings as 3D BookCloud.
      // Source: ease-out pulse (1.5× peak at midpoint) + force full alpha.
      // Cascade: newly-illuminated neighbours fade alpha 0 → ILLUMINATED_ALPHA
      // with deterministic per-book stagger 0–300 ms after a 300 ms delay.
      let alphaOverride: number | null = null;
      if (ignitedBook.bookId && ignitedBook.at != null) {
        const elapsed = Date.now() - ignitedBook.at;
        if (elapsed >= 0) {
          if (node.id === ignitedBook.bookId && elapsed < IGNITION_SOURCE_MS) {
            const t = elapsed / IGNITION_SOURCE_MS;
            const pulseAmount = (1 - t) * Math.sin(Math.PI * t);
            r *= 1 + (IGNITION_PULSE_PEAK - 1) * pulseAmount;
            alphaOverride = 1.0;
          }
          if (newlyIlluminatedRef.current.has(node.id)) {
            const cascadeWindowEnd = CASCADE_START_MS + CASCADE_STAGGER_MS + CASCADE_FADE_MS;
            if (elapsed < cascadeWindowEnd) {
              const stagger = staggerForBookId(node.id);
              const cascadeElapsed = elapsed - CASCADE_START_MS - stagger;
              if (cascadeElapsed < 0) {
                alphaOverride = 0;
              } else if (cascadeElapsed < CASCADE_FADE_MS) {
                alphaOverride = ILLUMINATED_ALPHA * (cascadeElapsed / CASCADE_FADE_MS);
              }
            }
          }
        }
      }

      const x = node.x ?? 0;
      const y = node.y ?? 0;

      // Per-book fill alpha. Canvas globalAlpha multiplies all fills until
      // restore() — wrap the whole node paint so radii / glow / colour all
      // dim together. Labels render outside the save/restore at full alpha
      // so they stay readable.
      ctx.save();
      ctx.globalAlpha = alphaOverride !== null ? alphaOverride : intensity.alphaFactor;

      // Outer glow — kept for shelf / illuminated / selected / hovered;
      // suppressed for plain background books so 12k+ tiny halos don't
      // accumulate into a wash at close zoom.
      if (intensity.tier !== "background" || isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2, 0, 2 * Math.PI, false);
        ctx.fillStyle = intensity.color + "22"; // ~13% alpha
        ctx.fill();
      }

      // Core circle.
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI, false);
      ctx.fillStyle = intensity.color;
      ctx.fill();

      ctx.restore();

      // Label when zoomed close enough — drawn at full alpha so it stays
      // readable regardless of the book's tier.
      if (globalScale >= LABEL_ZOOM_THRESHOLD || isSelected) {
        const fontSize = Math.max(6, 10 / Math.max(globalScale, 1)) + (isSelected ? 1 : 0);
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#FFFFFF" : "rgba(255,255,255,0.55)";
        ctx.fillText(node.title, x, y + r + 1);
      }
    },
    [selectedBookId, hoveredBookId, highlightedSeriesId, getBookState, illuminatedBookIds, regionShelfCounts, awakenedRegion, ignitedBook, newlyIlluminatedRef, fogLevel],
  );

  // Hit-test paint — make the click target a bit larger than the visual node.
  const paintHitArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      if (node.kind === "region") {
        // Region planets get a generous hit area so they're easy to grab as
        // the surrounding cluster gets dense. Painted before book hits so
        // overlapping books still register clicks (last-paint-wins).
        ctx.beginPath();
        ctx.arc(node.x ?? node.fx, node.y ?? node.fy, 16, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();
        return;
      }
      const score = displayScore01(node);
      const baseR = NODE_RADIUS_MIN + score * (NODE_RADIUS_MAX - NODE_RADIUS_MIN);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, baseR * NODE_HIT_RADIUS_FACTOR, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  // Reading-path trail: gold polyline through the user's read books in the
  // current sort order. Toggled by the existing top-right "Path" button.
  // Both glow and core paths trace the same point list; computing it once
  // avoids re-walking sortedPath twice.
  const drawReadingPath = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!showPath || sortedPath.length < 2) return;

      // Resolve each step to its current canvas position. Steps whose node
      // hasn't entered graphData yet (race during book additions) split the
      // line into separate subpaths so we don't draw straight across gaps.
      const segments: Array<Array<[number, number]>> = [];
      let current: Array<[number, number]> = [];
      for (const step of sortedPath) {
        const node = nodeById.get(step.bookId);
        if (!node || node.x == null || node.y == null) {
          if (current.length >= 2) segments.push(current);
          current = [];
          continue;
        }
        current.push([node.x, node.y]);
      }
      if (current.length >= 2) segments.push(current);
      if (segments.length === 0) return;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Glow underlay first so the core line sits cleanly on top.
      ctx.strokeStyle = PATH_GLOW_COLOR;
      ctx.lineWidth = PATH_GLOW_WIDTH;
      for (const seg of segments) {
        ctx.beginPath();
        ctx.moveTo(seg[0][0], seg[0][1]);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i][0], seg[i][1]);
        ctx.stroke();
      }

      ctx.strokeStyle = PATH_CORE_COLOR;
      ctx.lineWidth = PATH_CORE_WIDTH;
      for (const seg of segments) {
        ctx.beginPath();
        ctx.moveTo(seg[0][0], seg[0][1]);
        for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i][0], seg[i][1]);
        ctx.stroke();
      }
      ctx.restore();
    },
    [showPath, sortedPath, nodeById],
  );

  // Similar-reads beams: thin cyan rays from the selected book to each of
  // its 3 nearest neighbours by similarity. Drawn before region labels so
  // labels stay readable on top.
  const drawSimilarEdges = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!selectedBookId || similarBookIds.length === 0) return;
      const source = nodeById.get(selectedBookId);
      if (!source) return;

      ctx.save();
      ctx.strokeStyle = SIMILAR_EDGE_COLOR;
      ctx.lineWidth = SIMILAR_EDGE_WIDTH;
      ctx.lineCap = "round";
      for (const targetId of similarBookIds) {
        const target = nodeById.get(targetId);
        if (!target) continue;
        ctx.beginPath();
        ctx.moveTo(source.x ?? 0, source.y ?? 0);
        ctx.lineTo(target.x ?? 0, target.y ?? 0);
        ctx.stroke();
      }
      ctx.restore();
    },
    [selectedBookId, similarBookIds, nodeById],
  );

  // D6 reading-trail comet in 2D — short fading gold polyline through the
  // user's three most-recent shelf additions, plus a particle wake from
  // the head book that fires for ~5 seconds whenever a new book is added.
  // Mirrors the 3D ReadingTrail; particle spawn re-uses the D1 ignitedBook
  // timestamp so add-events fire both visualisations on the same signal.
  const TRAIL_PARTICLE_COUNT = 40;
  const TRAIL_PARTICLE_LIFETIME_S = 5;
  const TRAIL_PARTICLE_SPEED = 0.5; // canvas units per second; scaled visually
  const trailParticlesRef = useRef<{
    positions: Float32Array;
    velocities: Float32Array;
    ages: Float32Array;
    lastFrameTime: number;
    lastIgnitedAt: number | null;
  } | null>(null);
  // Intentionally disabled per user feedback (the gold "last 3 added"
  // comet didn't add anything). Kept defined so re-enabling is one line:
  // uncomment the call in drawOverlays + restore drawReadingTrail in the deps.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const drawReadingTrail = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // Initialise particle storage lazily on first paint.
      if (trailParticlesRef.current === null) {
        const ages = new Float32Array(TRAIL_PARTICLE_COUNT);
        ages.fill(TRAIL_PARTICLE_LIFETIME_S + 1);
        trailParticlesRef.current = {
          positions: new Float32Array(TRAIL_PARTICLE_COUNT * 2),
          velocities: new Float32Array(TRAIL_PARTICLE_COUNT * 2),
          ages,
          lastFrameTime: 0,
          lastIgnitedAt: null,
        };
      }
      const p = trailParticlesRef.current;

      // Resolve the trail's 0–3 endpoints from live node positions.
      const trailNodes: Array<{ x: number; y: number }> = [];
      for (const s of recentShelfBooks) {
        const node = nodeById.get(s.bookId);
        if (!node || node.x == null || node.y == null) continue;
        trailNodes.push({ x: node.x, y: node.y });
      }

      // Polyline — 2 segments max with a fading alpha gradient.
      if (trailNodes.length >= 2) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#FFD700";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < trailNodes.length - 1; i++) {
          const t = trailNodes.length <= 2 ? 0 : i / (trailNodes.length - 2);
          const opacity = 0.85 + (0.20 - 0.85) * t;
          ctx.globalAlpha = opacity;
          ctx.beginPath();
          ctx.moveTo(trailNodes[i].x, trailNodes[i].y);
          ctx.lineTo(trailNodes[i + 1].x, trailNodes[i + 1].y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Particle wake — respawn on ignition event, advance per frame.
      const now = performance.now();
      const dt = p.lastFrameTime === 0 ? 0 : (now - p.lastFrameTime) / 1000;
      p.lastFrameTime = now;

      if (
        ignitedBook.at != null &&
        ignitedBook.bookId != null &&
        ignitedBook.at !== p.lastIgnitedAt
      ) {
        p.lastIgnitedAt = ignitedBook.at;
        // Spawn from the *ignited* book's live node, not the trail head.
        // Status changes on a book that isn't most-recently-added still
        // produce a burst from that book's position, while the trail
        // polyline continues to reflect the ordered-by-addedAt list.
        const ignitedNode = nodeById.get(ignitedBook.bookId);
        if (ignitedNode && ignitedNode.x != null && ignitedNode.y != null) {
          for (let i = 0; i < TRAIL_PARTICLE_COUNT; i++) {
            p.positions[i * 2 + 0] = ignitedNode.x;
            p.positions[i * 2 + 1] = ignitedNode.y;
            const angle = Math.random() * Math.PI * 2;
            const sp = TRAIL_PARTICLE_SPEED * (0.6 + Math.random() * 0.8);
            p.velocities[i * 2 + 0] = Math.cos(angle) * sp;
            p.velocities[i * 2 + 1] = Math.sin(angle) * sp;
            p.ages[i] = 0;
          }
        }
      }

      ctx.save();
      for (let i = 0; i < TRAIL_PARTICLE_COUNT; i++) {
        if (p.ages[i] >= TRAIL_PARTICLE_LIFETIME_S) continue;
        p.ages[i] += dt;
        p.positions[i * 2 + 0] += p.velocities[i * 2 + 0] * dt;
        p.positions[i * 2 + 1] += p.velocities[i * 2 + 1] * dt;
        const life = Math.min(1, p.ages[i] / TRAIL_PARTICLE_LIFETIME_S);
        const alpha = (1 - life) * 0.6;
        const radius = 2 * (1 + life * 1.5);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(255, 215, 0, 1)";
        ctx.beginPath();
        ctx.arc(p.positions[i * 2 + 0], p.positions[i * 2 + 1], radius, 0, 2 * Math.PI, false);
        ctx.fill();
      }
      ctx.restore();
    },
    [recentShelfBooks, nodeById, ignitedBook],
  );

  // D8 hover-trace — draw bright white arcs from the hovered book to its
  // illumination connections. Symmetric: hovering a shelf book brightens
  // the lines to its 6 illuminated neighbours; hovering an illuminated
  // book brightens the line(s) back to its source shelf book(s).
  // 3D's IlluminationEdges component does the analogous highlight via a
  // separate brighter BufferGeometry; 2D has no persistent edge layer
  // (force-graph link rendering is series-only) so we paint on demand.
  const drawHoverTrace = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!hoveredBookId) return;
      const hoverNode = nodeById.get(hoveredBookId);
      if (!hoverNode || hoverNode.x == null || hoverNode.y == null) return;

      // Collect connected book ids in two cases:
      //  (a) hovered book is illuminated → look up its illuminators directly.
      //  (b) hovered book is on shelf → scan illuminationMap values for it.
      const connected: string[] = [];
      const directIlluminators = illuminationMap.get(hoveredBookId);
      if (directIlluminators) {
        connected.push(...directIlluminators);
      }
      // Case (b): does any illuminationMap entry list hoveredBookId as illuminator?
      for (const [illuminatedId, illuminators] of illuminationMap) {
        if (illuminators.includes(hoveredBookId)) {
          connected.push(illuminatedId);
        }
      }
      if (connected.length === 0) return;

      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      for (const otherId of connected) {
        const other = nodeById.get(otherId);
        if (!other || other.x == null || other.y == null) continue;
        ctx.beginPath();
        ctx.moveTo(hoverNode.x, hoverNode.y);
        ctx.lineTo(other.x, other.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    [hoveredBookId, nodeById, illuminationMap],
  );

  // D3 north-star marker in 2D — pulsing gold dot at the live centroid of
  // shelf-book node positions. Tracks the d3 simulation's drift naturally
  // because we read live x/y from nodeById each frame. Eases over ~800 ms
  // when the centroid moves (e.g. after adding a book).
  const northStarPos2DRef = useRef<{ x: number; y: number } | null>(null);
  const lastNorthStarFrameRef = useRef<number>(0);
  const drawNorthStar = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (userLibrary.size === 0) {
        // Reset so a future first-book add snaps to its position rather
        // than easing from a stale value.
        northStarPos2DRef.current = null;
        lastNorthStarFrameRef.current = 0;
        return;
      }

      // Compute target as the average of live shelf-book node positions.
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const bookId of userLibrary.keys()) {
        const node = nodeById.get(bookId);
        if (!node || node.x == null || node.y == null) continue;
        sx += node.x;
        sy += node.y;
        n += 1;
      }
      if (n === 0) return;
      const target = { x: sx / n, y: sy / n };

      // Frame-rate independent ease toward target. First frame snaps;
      // subsequent frames decay exponentially with ~800 ms time constant.
      const now = performance.now();
      const dt =
        lastNorthStarFrameRef.current === 0
          ? 0
          : (now - lastNorthStarFrameRef.current) / 1000;
      lastNorthStarFrameRef.current = now;

      if (northStarPos2DRef.current === null) {
        northStarPos2DRef.current = target;
      } else {
        const alpha = 1 - Math.exp(-dt / 0.8);
        northStarPos2DRef.current = {
          x: northStarPos2DRef.current.x + (target.x - northStarPos2DRef.current.x) * alpha,
          y: northStarPos2DRef.current.y + (target.y - northStarPos2DRef.current.y) * alpha,
        };
      }

      const pos = northStarPos2DRef.current;
      const tSec = now / 1000;
      const corePulse = 1 + 0.08 * Math.sin(tSec * 0.8);
      const haloPulse = 1 + 0.15 * Math.sin(tSec * 0.8);
      const CORE_R = 4;
      const HALO_R = CORE_R * 2.2;

      ctx.save();
      // Halo
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, HALO_R * haloPulse, 0, 2 * Math.PI, false);
      ctx.fillStyle = "rgba(255, 215, 0, 0.15)";
      ctx.fill();
      // Core
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, CORE_R * corePulse, 0, 2 * Math.PI, false);
      ctx.fillStyle = "rgba(255, 215, 0, 0.85)";
      ctx.fill();
      ctx.restore();
    },
    [userLibrary, nodeById],
  );

  // Compose all post-render overlays into a single callback so we hand
  // ForceGraph2D one stable function. Paint order (bottom → top):
  //   1. Reading path (large structural trail; user's journey)
  //   2. Similar-reads beams (selection-tied, more local)
  //   3. Hover-trace arcs (hover-driven, brighten illumination connections)
  //   4. Reading-trail comet (last 3 added + particle wake; D6)
  //   5. North-star marker (small but bright; sits above paths/beams)
  // Region labels are now painted by the planet itself (paintNode) so they
  // travel with the planet during a drag rather than tracking the cluster
  // centroid (which lags behind the planet under regionGravity).
  const drawOverlays = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      drawReadingPath(ctx);
      drawSimilarEdges(ctx);
      drawHoverTrace(ctx);
      // drawReadingTrail intentionally disabled — user feedback that the
      // gold last-3-added comet didn't add anything (see RegionPlanets.tsx
      // for the matching 3D removal). The fn + recentShelfBooks state are
      // kept so this is a one-line re-enable if we change our mind.
      // drawReadingTrail(ctx);
      drawNorthStar(ctx);
    },
    // drawReadingTrail intentionally omitted from deps — see the call site
    // above. Re-add to both list + call site to re-enable.
    [drawReadingPath, drawSimilarEdges, drawHoverTrace, drawNorthStar],
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: BG_COLOR }}
    >
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D
          ref={fgRef as never}
          width={size.width}
          height={size.height}
          backgroundColor={BG_COLOR}
          graphData={graphData}
          nodeId="id"
          nodeRelSize={1}
          enableNodeDrag={true}
          // Drag a book and the universe follows: connected series-mates pull
          // along via link springs, neighbours drift via the broader force
          // simulation. On release, clearing fx/fy un-pins the node so the
          // regionGravity force snaps it back to its home anchor.
          //
          // Region planets are pinned at their anchor via fx/fy on creation.
          // The lib temporarily overrides fx/fy during drag; on release we
          // restore them to the anchor so the planet snaps back home (E.7.4
          // will make the books trail along by giving regionGravity a live
          // target — for now they stay put while the planet drifts).
          onNodeDragEnd={((node: GraphNode) => {
            if (node.kind === "region") {
              const anchor = region2DAnchorMap.get(node.regionId);
              if (anchor) {
                node.fx = anchor.x;
                node.fy = anchor.y;
              }
              return;
            }
            (node as BookNode).fx = undefined;
            (node as BookNode).fy = undefined;
          }) as never}
          // d3 force tuning: settle fast, then freeze.
          cooldownTicks={300}
          d3AlphaDecay={0.04}
          d3VelocityDecay={0.55}
          // Custom paint paths.
          nodeCanvasObject={paintNode as never}
          nodePointerAreaPaint={paintHitArea as never}
          // Overlay layer: similar-reads beams + region labels, drawn after
          // nodes so they pan / zoom with the graph naturally.
          onRenderFramePost={drawOverlays as never}
          // Edges: subtle by default; the selected book's series edges are
          // highlighted amber so the series spine reads as a clear thread.
          // ForceGraph2D resolves link.source / link.target to actual node
          // objects after the first tick, so series_id is reachable.
          linkColor={((link: { source: { series_id?: string | null } | string; target: { series_id?: string | null } | string }) => {
            if (highlightedSeriesId == null) return LINK_COLOR;
            const sId = typeof link.source === "object" ? link.source.series_id : null;
            const tId = typeof link.target === "object" ? link.target.series_id : null;
            return sId === highlightedSeriesId && tId === highlightedSeriesId
              ? LINK_COLOR_HIGHLIGHTED
              : LINK_COLOR;
          }) as never}
          linkWidth={((link: { source: { series_id?: string | null } | string; target: { series_id?: string | null } | string }) => {
            if (highlightedSeriesId == null) return LINK_WIDTH;
            const sId = typeof link.source === "object" ? link.source.series_id : null;
            const tId = typeof link.target === "object" ? link.target.series_id : null;
            return sId === highlightedSeriesId && tId === highlightedSeriesId
              ? LINK_WIDTH_HIGHLIGHTED
              : LINK_WIDTH;
          }) as never}
          linkDirectionalParticles={0}
          // Interaction. Region planets call flyToRegion (toggles focus +
          // sets flyTarget); the fly-to effect picks that up and centres
          // the canvas on the planet's 2D anchor. Hover is suppressed so
          // the hovered-book glow doesn't smear onto regions.
          onNodeClick={((node: GraphNode) => {
            if (node.kind === "region") {
              flyToRegion(node.regionId);
              return;
            }
            setSelectedBook(node.id);
          }) as never}
          onBackgroundClick={() => setSelectedBook(null)}
          onNodeHover={((node: GraphNode | null) => {
            if (node && node.kind === "region") {
              setHoveredBook(null);
              return;
            }
            setHoveredBook(node ? node.id : null);
          }) as never}
        />
      )}
    </div>
  );
}

// ---------- Container resize observer ----------
//
// react-force-graph-2d expects explicit width/height. Using a ResizeObserver
// keeps the canvas matched to the parent without depending on any window-
// listener boilerplate or a CSS hack.

// ---------- Custom d3-force ----------

interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type D3ForceFn = ((alpha: number) => void) & {
  initialize?: (nodes: ForceNode[]) => void;
};

/**
 * Pulls each book toward its region planet's *live* x/y by a fraction of
 * the distance, weighted by alpha (so the nudge fades as the simulation
 * cools).
 *
 * Reads the planet's current position rather than a static anchor: when the
 * user drags a planet, every member book gets nudged toward the new
 * position; on release the planet's fx/fy is restored to the anchor (see
 * onNodeDragEnd), and the books follow it home over the next ~1 second of
 * settling.
 *
 * Region planets are identified by their namespaced "region:<id>" id and
 * are classified once at `initialize` time so the per-tick path stays cheap
 * (one map lookup per book, no re-classification).
 */
function makeRegionGravityForce(
  nodeToRegion: Map<string, string>,
  strength: number,
): D3ForceFn {
  let bookRefs: ForceNode[] = [];
  let regionPlanets = new Map<string, ForceNode>();

  const force: D3ForceFn = (alpha: number) => {
    const k = strength * alpha;
    for (const node of bookRefs) {
      const regionId = nodeToRegion.get(node.id);
      if (!regionId) continue;
      const planet = regionPlanets.get(regionId);
      if (!planet) continue;
      node.vx += (planet.x - node.x) * k;
      node.vy += (planet.y - node.y) * k;
    }
  };
  force.initialize = (newNodes) => {
    bookRefs = [];
    regionPlanets = new Map();
    for (const n of newNodes) {
      const id = (n as ForceNode).id;
      if (typeof id === "string" && id.startsWith("region:")) {
        regionPlanets.set(id.slice("region:".length), n);
      } else {
        bookRefs.push(n);
      }
    }
  };
  return force;
}

// ---------- Container resize observer ----------

function useObserveSize(ref: React.RefObject<HTMLElement | null>): [
  { width: number; height: number },
  React.Dispatch<React.SetStateAction<{ width: number; height: number }>>,
] {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return [size, setSize];
}
