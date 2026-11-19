"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";

const TUBE_RADIUS = 0.003;
const GLOW_RADIUS = 0.008;
const TUBE_SEGMENTS = 8;
const RADIAL_SEGMENTS = 6;

interface EdgeGeoms {
  core: THREE.TubeGeometry;
  glow: THREE.TubeGeometry;
}

export function SimilarReadsEdges() {
  const { selectedBook, similarBookIds, books, spacingMultiplier, regionAnchorMap } = useNebula();

  const edges = useMemo<EdgeGeoms[]>(() => {
    if (!selectedBook || similarBookIds.length === 0) return [];

    const bookMap = new Map(books.map((b) => [b.id, b]));
    const [sx, sy, sz] = bookWorldPos(selectedBook, regionAnchorMap, spacingMultiplier);
    const start = new THREE.Vector3(sx, sy, sz);

    const result: EdgeGeoms[] = [];
    for (const id of similarBookIds) {
      const b = bookMap.get(id);
      if (!b) continue;
      const [bx, by, bz] = bookWorldPos(b, regionAnchorMap, spacingMultiplier);
      const end = new THREE.Vector3(bx, by, bz);
      const curve = new THREE.LineCurve3(start, end);
      result.push({
        core: new THREE.TubeGeometry(curve, TUBE_SEGMENTS, TUBE_RADIUS, RADIAL_SEGMENTS, false),
        glow: new THREE.TubeGeometry(curve, TUBE_SEGMENTS, GLOW_RADIUS, RADIAL_SEGMENTS, false),
      });
    }
    return result;
  }, [selectedBook, similarBookIds, books, regionAnchorMap, spacingMultiplier]);

  if (edges.length === 0) return null;

  return (
    <group renderOrder={2}>
      {edges.map((e, i) => (
        <group key={i}>
          {/* Core tube */}
          <mesh geometry={e.core}>
            <meshStandardMaterial
              color="#38BDF8"
              emissive="#38BDF8"
              emissiveIntensity={0.5}
              transparent
              opacity={0.7}
              toneMapped={false}
            />
          </mesh>
          {/* Glow halo */}
          <mesh geometry={e.glow}>
            <meshStandardMaterial
              color="#38BDF8"
              emissive="#38BDF8"
              emissiveIntensity={0.2}
              transparent
              opacity={0.15}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
