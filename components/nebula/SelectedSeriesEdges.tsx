"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";

export function SelectedSeriesEdges() {
  const { selectedBook, books, spacingMultiplier, regionAnchorMap } = useNebula();

  const geometry = useMemo(() => {
    if (!selectedBook?.series_id) return null;

    const seriesId = selectedBook.series_id;
    const seriesBooks = books
      .filter((b) => b.series_id === seriesId)
      .sort((a, b) => (a.series_order ?? 999) - (b.series_order ?? 999));

    if (seriesBooks.length < 2) return null;

    const positions: number[] = [];
    for (let i = 0; i < seriesBooks.length - 1; i++) {
      const a = seriesBooks[i];
      const b = seriesBooks[i + 1];
      const [ax, ay, az] = bookWorldPos(a, regionAnchorMap, spacingMultiplier);
      const [bx, by, bz] = bookWorldPos(b, regionAnchorMap, spacingMultiplier);
      positions.push(ax, ay, az, bx, by, bz);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [selectedBook, books, regionAnchorMap, spacingMultiplier]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry} renderOrder={2}>
      <lineBasicMaterial
        color="#FFFFFF"
        transparent
        opacity={0.7}
        linewidth={2}
        depthWrite={false}
      />
    </lineSegments>
  );
}
