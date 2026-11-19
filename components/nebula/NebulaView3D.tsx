"use client";

/**
 * 3D scene — the R3F <Canvas> block lifted out of NebulaView so the
 * orchestrator can swap between this and NebulaView2D based on viewMode.
 *
 * Owns the R3F-specific scene components only. HTML overlays
 * (BookDetailPanel, NebulaSearch, etc.) live one level up so they're shared
 * across both modes.
 */

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { useNebula } from "@/lib/nebula/nebula-context";
import { BookCloud } from "./BookCloud";
import { RegionPlanets } from "./RegionPlanets";
import { SeriesLabels } from "./SeriesLabels";
import { IlluminationEdges } from "./IlluminationEdges";
import { CameraController } from "./CameraController";
import { NebulaPathLine } from "./NebulaPathLine";
import { SimilarReadsEdges } from "./SimilarReadsEdges";
import { SelectedSeriesEdges } from "./SelectedSeriesEdges";
import { NorthStar } from "./NorthStar";
// import { ReadingTrail } from "./ReadingTrail"; // disabled per user feedback; see line below
import { ShelfHull } from "./ShelfHull";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";

export function NebulaView3D() {
  const { books, regions, seriesNames, setSelectedBook, zoomLevel } = useNebula();
  const showBooks = zoomLevel !== "galaxy";
  const controlsRef = useRef<OrbitControlsType>(null);

  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 55 }}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => setSelectedBook(null)}
      style={{ background: "#05070A" }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 5]} intensity={0.8} />
      <pointLight position={[-3, -2, -3]} intensity={0.3} color="#6366F1" />

      <RegionPlanets regions={regions} books={books} />

      {/* Books always render so the user gets a peripheral "stars are
          there" cue even at galaxy zoom — gives a sense of the universe's
          scale without filling the view with edges or labels. Edges +
          series labels stay gated since they're zoom-in interactions and
          would be visual mosh at galaxy distance. */}
      <BookCloud books={books} regions={regions} />
      {showBooks && <IlluminationEdges books={books} />}
      {showBooks && <SimilarReadsEdges />}
      {showBooks && <SelectedSeriesEdges />}
      {showBooks && <SeriesLabels books={books} seriesNames={seriesNames} />}

      <NebulaPathLine />
      <NorthStar />
      {/* ReadingTrail (the gold "last 3 added" comet) intentionally removed
          — user feedback that it didn't add anything. Component file +
          recentShelfBooks derived state both kept so it's a one-line
          re-mount if we change our mind. */}
      <ShelfHull />

      <Stars radius={8} depth={50} count={3000} factor={2} saturation={0} fade speed={0.5} />

      <CameraController controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={0.3}
        maxDistance={8}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
      />
    </Canvas>
  );
}
