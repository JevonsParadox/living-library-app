"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";

/**
 * Renders a soft transparent convex hull around all owned books,
 * visualising the spatial extent of the user's library.
 *
 * Only visible when `showMyShelf` is toggled and there are ≥ 4 owned
 * books (minimum for a 3D convex hull).
 */
export function ShelfHull() {
  const { books, userLibrary, showMyShelf, spacingMultiplier, regionAnchorMap } = useNebula();

  const geometry = useMemo(() => {
    if (!showMyShelf) return null;

    const ownedPositions: THREE.Vector3[] = [];
    for (const [bookId, st] of userLibrary) {
      if (st.ownership !== "owned") continue;
      const book = books.find((b) => b.id === bookId);
      if (book) {
        const [bx, by, bz] = bookWorldPos(book, regionAnchorMap, spacingMultiplier);
        ownedPositions.push(new THREE.Vector3(bx, by, bz));
      }
    }

    if (ownedPositions.length < 4) return null;

    try {
      return new ConvexGeometry(ownedPositions);
    } catch {
      // ConvexGeometry can fail if points are coplanar — degrade gracefully
      return null;
    }
  }, [books, userLibrary, showMyShelf, regionAnchorMap, spacingMultiplier]);

  if (!geometry) return null;

  return (
    <group renderOrder={-3}>
      {/* Soft transparent fill */}
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#FFD700"
          transparent
          opacity={0.02}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Wireframe overlay for the faceted-boundary feel */}
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#FFD700"
          transparent
          opacity={0.06}
          wireframe
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
