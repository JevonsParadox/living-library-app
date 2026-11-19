/**
 * Path sort utilities — derive different ordered views of the user's reading path.
 * Pure client-side, no I/O.
 */

export type PathSortMode = "constellation" | "chronological" | "alphabetical";

export interface PathBook {
  bookId: string;
  title: string;
  x: number;
  y: number;
  z: number;
  readAt: string | null;
  daysGapToNext: number | null;
}

/**
 * Constellation order: greedy nearest-neighbor traversal from the first book.
 * O(n^2) — fine for paths up to a few hundred books.
 */
function sortByConstellation(path: PathBook[]): PathBook[] {
  if (path.length <= 1) return [...path];

  const remaining = new Set(path.map((p) => p.bookId));
  const lookup = new Map(path.map((p) => [p.bookId, p]));

  // Start at the first book in original order.
  const startId = path[0].bookId;
  remaining.delete(startId);
  const ordered: PathBook[] = [path[0]];

  while (remaining.size > 0) {
    const last = ordered[ordered.length - 1];
    let bestId = "";
    let bestDist = Infinity;
    for (const id of remaining) {
      const candidate = lookup.get(id)!;
      const dx = candidate.x - last.x;
      const dy = candidate.y - last.y;
      const dz = candidate.z - last.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDist) {
        bestDist = d2;
        bestId = id;
      }
    }
    ordered.push(lookup.get(bestId)!);
    remaining.delete(bestId);
  }

  return ordered;
}

/**
 * Chronological: books with dates first, sorted ascending; books without dates appended at the end
 * (so they remain visible).
 */
function sortByChronological(path: PathBook[]): PathBook[] {
  const dated = path.filter((p) => p.readAt !== null);
  const undated = path.filter((p) => p.readAt === null);

  dated.sort((a, b) => new Date(a.readAt!).getTime() - new Date(b.readAt!).getTime());
  return [...dated, ...undated];
}

function sortByAlphabetical(path: PathBook[]): PathBook[] {
  return [...path].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
}

export function sortPath(path: PathBook[], mode: PathSortMode): PathBook[] {
  switch (mode) {
    case "constellation":
      return sortByConstellation(path);
    case "chronological":
      return sortByChronological(path);
    case "alphabetical":
      return sortByAlphabetical(path);
  }
}
