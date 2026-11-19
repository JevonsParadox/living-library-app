"use client";

import { useMemo, useCallback, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import { regionWorldPos } from "@/lib/nebula/world-scale";
import { EMPTY_REGION_COLOR, regionPlanetIntensity } from "@/lib/nebula/book-display";
import type { NbRegion } from "@/lib/nebula/nebula-types";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";

const PLANET_MIN_RADIUS = 0.04;
const PLANET_MAX_RADIUS = 0.06;
const ATMOSPHERE_SCALE = 1.4;
const HALO_MIN_RADIUS = 0.20;
const HALO_MAX_RADIUS = 0.35;
// Baseline opacities — multiplied by regionPlanetIntensity.alphaFactor to
// scale brightness with the user's shelf count for that region.
const HALO_OPACITY_BASE = 0.03;
const ATMOSPHERE_OPACITY_BASE = 0.12;
const CORE_EMISSIVE_BASE = 0.6;
// D2 region awakening flash — fires when a region's shelf count goes 0→N.
// Curve `(1 - t) * sin(π·t)` peaks just past midpoint, fades to zero by
// the end of the duration. Multipliers stack on top of the steady-state
// D4 brightness.
const FLASH_DURATION_MS = 1000;
const FLASH_PLANET_PEAK = 1.2;   // up to +20% radius at peak
const FLASH_HALO_PEAK = 3.0;     // up to 3× halo opacity at peak
// Color-lerp during the flash: ramp grey → region color linearly across the
// first ~67% of the flash window, then hold full color. Lets the colour
// "fill in" before the brightness pulse fades — the D1 ignition + D2
// awakening read as one continuous moment.
const COLOR_LERP_FRACTION = 0.67;

// --- Planet core fresnel shader ---
// Mirrors the dark-core / bright-rim shader on BookCloud but with a softer
// exponent (1.5 vs 2.0) and a lighter core mix (0.55 vs 0.25) — planets are
// ~10× the radius of book stars so the rim falloff reads as orb depth
// rather than glow. Single uniform for color (driven by the grey-to-region
// awakening lerp) + an emissive multiplier (driven by D4 + flash brightness).

const planetVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const planetFragmentShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  uniform vec3 uColor;
  uniform float uEmissive;
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 1.5);
    vec3 dimCore = uColor * 0.55;
    vec3 brightRim = uColor * (1.0 + fresnel * 1.4);
    vec3 col = mix(dimCore, brightRim, fresnel);
    gl_FragColor = vec4(col * uEmissive, 1.0);
  }
`;

// --- Types ---

interface RegionPlanetsProps {
  regions: NbRegion[];
  books: NbBookWithCoords[];
}

// --- Single Region Planet ---

function RegionPlanet({
  region,
  planetRadius,
  haloRadius,
  shelfCount,
}: {
  region: NbRegion;
  planetRadius: number;
  haloRadius: number;
  shelfCount: number;
}) {
  const { flyToRegion, awakenedRegion } = useNebula();
  const planetRef = useRef<THREE.Mesh>(null);
  // Refs for D2 flash animation — useFrame mutates scale, material opacities,
  // and shader uniforms each frame. React state would re-render every tick.
  const groupRef = useRef<THREE.Group>(null);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const atmosphereMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const planetMatRef = useRef<THREE.ShaderMaterial>(null);

  // "Real" region color and the empty-state grey. The displayed color each
  // frame is a lerp between these driven by D2 awakening progress.
  const regionColor = useMemo(
    () => new THREE.Color(region.color_hex ?? "#8B9DC3"),
    [region.color_hex],
  );
  const greyColor = useMemo(() => new THREE.Color(EMPTY_REGION_COLOR), []);
  // Reused per-frame buffer — avoids allocating a Color each tick.
  const tmpColor = useRef(new THREE.Color()).current;

  // D4: planet brightness scales with how many books from this region the
  // user has on shelf. Empty region = faint outline (40% alpha + 50% halo);
  // 30+ books = full strength. sqrt scaling so the first few books register.
  const intensity = useMemo(() => regionPlanetIntensity({ shelfCount }), [shelfCount]);
  const haloOpacity = HALO_OPACITY_BASE * intensity.alphaFactor;
  const atmosphereOpacity = ATMOSPHERE_OPACITY_BASE * intensity.alphaFactor;
  const coreEmissive = CORE_EMISSIVE_BASE * intensity.alphaFactor;
  const effectiveHaloRadius = haloRadius * intensity.haloFactor;

  // Stable uniforms object — R3F creates the shader material once when it
  // first sees this reference and reuses it across renders. We mutate the
  // value fields in useFrame; React doesn't see the changes (which is
  // exactly what we want — no re-renders from per-frame data).
  const planetUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(EMPTY_REGION_COLOR) },
      uEmissive: { value: CORE_EMISSIVE_BASE },
    }),
    [],
  );

  // Region anchors are intentionally not affected by the spacing slider —
  // only books move outward from their anchor when the slider widens.
  const worldPos = useMemo<[number, number, number]>(
    () => regionWorldPos(region),
    [region],
  );

  // Slow rotation + D2 awakening flash + grey-to-color lerp on first book.
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * 0.03;
    }

    // --- D2 awakening detection ---
    const isMe = awakenedRegion.regionId === region.id && awakenedRegion.at != null;
    let flashAmount = 0;
    // Color progress: 0 = full grey, 1 = full region color. Default to
    // 1 if the region already has books (steady-state colored), 0 otherwise.
    let colorProgress = shelfCount > 0 ? 1 : 0;
    if (isMe) {
      const elapsed = Date.now() - (awakenedRegion.at as number);
      if (elapsed >= 0 && elapsed < FLASH_DURATION_MS) {
        const t = elapsed / FLASH_DURATION_MS;
        flashAmount = (1 - t) * Math.sin(Math.PI * t);
        // Linear ramp to full color across the first 67% of the flash, then
        // hold. Distinct curve from flashAmount — we want the color to be
        // already-full while the pulse is still glowing on top.
        colorProgress = Math.min(1, t / COLOR_LERP_FRACTION);
      }
    }

    const radiusMul = 1 + (FLASH_PLANET_PEAK - 1) * flashAmount;
    const opacityMul = 1 + (FLASH_HALO_PEAK - 1) * flashAmount;

    if (groupRef.current) {
      groupRef.current.scale.setScalar(radiusMul);
    }

    // Single shared current color, written into all three materials below.
    tmpColor.copy(greyColor).lerp(regionColor, colorProgress);

    if (haloMaterialRef.current) {
      haloMaterialRef.current.color.copy(tmpColor);
      haloMaterialRef.current.opacity = haloOpacity * opacityMul;
    }
    if (atmosphereMaterialRef.current) {
      atmosphereMaterialRef.current.color.copy(tmpColor);
      atmosphereMaterialRef.current.opacity = atmosphereOpacity * opacityMul;
    }
    if (planetMatRef.current) {
      planetMatRef.current.uniforms.uColor.value.copy(tmpColor);
      // Slight emissive boost during the flash pulse so the rim brightens
      // alongside halo + atmosphere — keeps the awakening visually unified.
      planetMatRef.current.uniforms.uEmissive.value = coreEmissive * opacityMul;
    }
  });

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      flyToRegion(region.id);
    },
    [flyToRegion, region.id],
  );

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
  }, []);

  const handlePointerOut = useCallback(() => {
    document.body.style.cursor = "auto";
  }, []);

  return (
    <group ref={groupRef} position={worldPos}>
      {/* Halo — wide encompassing sphere. Initial color = grey; useFrame
          mutates the underlying THREE.Color each tick. */}
      <mesh renderOrder={-2}>
        <sphereGeometry args={[effectiveHaloRadius, 24, 16]} />
        <meshBasicMaterial
          ref={haloMaterialRef}
          color={greyColor}
          transparent
          opacity={haloOpacity}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Atmosphere shell */}
      <mesh renderOrder={-1}>
        <sphereGeometry args={[planetRadius * ATMOSPHERE_SCALE, 16, 12]} />
        <meshBasicMaterial
          ref={atmosphereMaterialRef}
          color={greyColor}
          transparent
          opacity={atmosphereOpacity}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Planet core — fresnel shader gives the orb depth (dim core,
          bright rim). Color + emissive driven by useFrame so they animate
          smoothly with the D2 awakening pulse. */}
      <mesh
        ref={planetRef}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[planetRadius, 32, 24]} />
        <shaderMaterial
          ref={planetMatRef}
          uniforms={planetUniforms}
          vertexShader={planetVertexShader}
          fragmentShader={planetFragmentShader}
          toneMapped={false}
        />
      </mesh>

      {/* Label — using Html like the old RegionLabels (known to work) */}
      <Html center distanceFactor={3}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            flyToRegion(region.id);
          }}
          className="text-center select-none cursor-pointer hover:scale-110 transition-transform"
        >
          <p
            className="text-[11px] font-semibold whitespace-nowrap tracking-wide hover:opacity-90 transition-opacity"
            style={{
              color: "rgba(255, 255, 255, 0.6)",
              textShadow: "0 0 8px rgba(0, 0, 0, 0.8), 0 0 2px rgba(0, 0, 0, 0.6)",
            }}
          >
            {region.name}
          </p>
        </button>
      </Html>
    </group>
  );
}

// --- Main Component ---

export function RegionPlanets({ regions, books }: RegionPlanetsProps) {
  const { regionShelfCounts } = useNebula();

  // Catalog-side counts drive the planet's *physical* size — bigger genre,
  // bigger planet — independent of the user's shelf. Shelf-side counts
  // (regionShelfCounts from context) drive *brightness* via D4 inside
  // the RegionPlanet component.
  const regionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of books) {
      if (b.region_id) counts.set(b.region_id, (counts.get(b.region_id) ?? 0) + 1);
    }
    return counts;
  }, [books]);

  const maxCount = useMemo(() => Math.max(...regionCounts.values(), 1), [regionCounts]);

  return (
    <>
      {regions.map((region) => {
        const count = regionCounts.get(region.id) ?? 0;
        // Always render — empty regions stay as navigational landmarks even
        // when the catalog hasn't reached them yet. Size is floored at 20%
        // of the populated max so empty planets aren't 30px specks (the
        // PLANET_MIN_RADIUS baseline alone hits the lower bound when the
        // catalog is sparse and one region dominates maxCount).
        const t = Math.max(0.2, count / maxCount);
        const planetRadius = PLANET_MIN_RADIUS + t * (PLANET_MAX_RADIUS - PLANET_MIN_RADIUS);
        const haloRadius = HALO_MIN_RADIUS + t * (HALO_MAX_RADIUS - HALO_MIN_RADIUS);
        const shelfCount = regionShelfCounts.get(region.id) ?? 0;

        return (
          <RegionPlanet
            key={region.id}
            region={region}
            planetRadius={planetRadius}
            haloRadius={haloRadius}
            shelfCount={shelfCount}
          />
        );
      })}
    </>
  );
}
