"use client";

/**
 * Faint white line segments from each shelf book to the ~6 illuminated
 * candidates it lit up. Replaces the old SeriesEdges (which connected
 * every consecutive series pair across the whole catalog — too noisy
 * under Phase G's shelf-driven model).
 *
 * Two passes:
 *   - "base"      : every illumination edge, faint white (opacity 0.12)
 *   - "highlight" : only edges where one endpoint matches `hoveredBookId`,
 *                   bright white (opacity 0.6) overlaid on top.
 *
 * Behaviour is symmetric — hovering a shelf book brightens its outgoing
 * lines, hovering an illuminated book brightens the lines back to its
 * source(s). Same edges, different vantage point.
 *
 * With 30 shelf books × 6 neighbours each (deduped) ≈ ~150 segments.
 * Splitting into two BufferGeometries on each hover change is trivial.
 */

import { useMemo } from "react";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";

interface IlluminationEdgesProps {
  books: NbBookWithCoords[];
}

export function IlluminationEdges({ books }: IlluminationEdgesProps) {
  const { illuminationMap, hoveredBookId, spacingMultiplier, regionAnchorMap } = useNebula();

  const geometries = useMemo(() => {
    if (illuminationMap.size === 0) return null;

    // bookId → world position lookup. Built once so we can resolve both
    // endpoints without scanning the books array per edge.
    const bookById = new Map<string, NbBookWithCoords>();
    for (const b of books) bookById.set(b.id, b);

    const basePositions: number[] = [];
    const highlightPositions: number[] = [];

    // illuminationMap: illuminated bookId → list of shelf bookIds (illuminators).
    for (const [illuminatedId, illuminators] of illuminationMap) {
      const target = bookById.get(illuminatedId);
      if (!target) continue;
      const [tx, ty, tz] = bookWorldPos(target, regionAnchorMap, spacingMultiplier);

      for (const illuminatorId of illuminators) {
        const source = bookById.get(illuminatorId);
        if (!source) continue;
        const [sx, sy, sz] = bookWorldPos(source, regionAnchorMap, spacingMultiplier);
        const isHovered =
          hoveredBookId != null &&
          (illuminatedId === hoveredBookId || illuminatorId === hoveredBookId);
        const target_arr = isHovered ? highlightPositions : basePositions;
        target_arr.push(sx, sy, sz, tx, ty, tz);
      }
    }

    const baseGeo = basePositions.length > 0 ? new THREE.BufferGeometry() : null;
    if (baseGeo) {
      baseGeo.setAttribute("position", new THREE.Float32BufferAttribute(basePositions, 3));
    }
    const highlightGeo = highlightPositions.length > 0 ? new THREE.BufferGeometry() : null;
    if (highlightGeo) {
      highlightGeo.setAttribute("position", new THREE.Float32BufferAttribute(highlightPositions, 3));
    }
    return { baseGeo, highlightGeo };
  }, [books, illuminationMap, hoveredBookId, regionAnchorMap, spacingMultiplier]);

  if (!geometries) return null;

  return (
    <>
      {geometries.baseGeo && (
        <lineSegments geometry={geometries.baseGeo}>
          <lineBasicMaterial
            color="#FFFFFF"
            transparent
            opacity={0.06}
            linewidth={1}
          />
        </lineSegments>
      )}
      {geometries.highlightGeo && (
        <lineSegments geometry={geometries.highlightGeo} renderOrder={1}>
          <lineBasicMaterial
            color="#FFFFFF"
            transparent
            opacity={0.6}
            linewidth={2}
            depthWrite={false}
          />
        </lineSegments>
      )}
    </>
  );
}
