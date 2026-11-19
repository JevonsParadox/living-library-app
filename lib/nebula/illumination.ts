/**
 * For each shelf book, find ~k nearest non-shelf neighbours and aggregate
 * a many-to-many illumination map: every non-shelf book becomes a key if
 * at least one shelf book illuminated it; the value lists which shelf
 * books recommend it (used by D8 hover-trace and any future tinting).
 *
 * Source priority per shelf book:
 *   1. Semantic edges (`edgesMap.get(shelfBookId)`) — cached server fetch
 *      from nb_book_edges (populated by build-similarity-edges.ts).
 *   2. Spatial KNN over (x, y, z) coords — fallback when no edges exist
 *      for that source book yet, or when the semantic list runs short
 *      after filtering out shelf-owned candidates.
 *
 * Pure function; no React, no Supabase. Caller supplies the edge cache.
 */

import type { NbBookWithCoords } from "./fetch-nebula-data";

export interface IlluminationResult {
  /** illuminated bookId → list of shelf bookIds that lit it (deduped) */
  illuminationMap: Map<string, string[]>;
  /** Just the keys, for O(1) `has()` checks in render paths */
  illuminatedBookIds: Set<string>;
}

export function computeIllumination(
  books: NbBookWithCoords[],
  shelfBookIds: Set<string>,
  edgesMap: Map<string, string[]>,
  k = 6,
): IlluminationResult {
  const illuminationMap = new Map<string, string[]>();
  if (shelfBookIds.size === 0) {
    return { illuminationMap, illuminatedBookIds: new Set() };
  }

  const bookById = new Map(books.map((b) => [b.id, b]));

  function spatialNeighbours(sourceId: string): string[] {
    const src = bookById.get(sourceId);
    if (!src) return [];
    const sx = src.x;
    const sy = src.y;
    const sz = src.z;
    const scored: Array<{ id: string; d2: number }> = [];
    for (const b of books) {
      if (b.id === sourceId || shelfBookIds.has(b.id)) continue;
      const dx = b.x - sx;
      const dy = b.y - sy;
      const dz = b.z - sz;
      scored.push({ id: b.id, d2: dx * dx + dy * dy + dz * dz });
    }
    scored.sort((a, b) => a.d2 - b.d2);
    return scored.slice(0, k).map((s) => s.id);
  }

  for (const shelfId of shelfBookIds) {
    let neighbourIds: string[];
    const edges = edgesMap.get(shelfId);
    if (edges && edges.length > 0) {
      // Edges are pre-ordered by rank. Filter out any shelf-owned hits and
      // take the top k. Top up with spatial if filtering left us short.
      neighbourIds = edges.filter((id) => !shelfBookIds.has(id)).slice(0, k);
      if (neighbourIds.length < k) {
        const seen = new Set(neighbourIds);
        for (const sId of spatialNeighbours(shelfId)) {
          if (seen.has(sId)) continue;
          neighbourIds.push(sId);
          if (neighbourIds.length >= k) break;
        }
      }
    } else {
      neighbourIds = spatialNeighbours(shelfId);
    }

    for (const nId of neighbourIds) {
      const sources = illuminationMap.get(nId);
      if (sources) {
        if (!sources.includes(shelfId)) sources.push(shelfId);
      } else {
        illuminationMap.set(nId, [shelfId]);
      }
    }
  }

  return {
    illuminationMap,
    illuminatedBookIds: new Set(illuminationMap.keys()),
  };
}
