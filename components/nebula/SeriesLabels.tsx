"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";

const MIN_BOOKS_FOR_LABEL = 2;

interface SeriesLabelsProps {
  books: NbBookWithCoords[];
  seriesNames: Record<string, string>;
}

export function SeriesLabels({ books, seriesNames }: SeriesLabelsProps) {
  const { selectedBookId, spacingMultiplier, regionAnchorMap } = useNebula();

  // Show series label only when a book is explicitly clicked. Hover used to
  // trigger this too but caused labels to flicker on as the cursor swept the
  // cloud — too noisy.
  const activeSeriesId = useMemo(() => {
    if (!selectedBookId) return null;
    const book = books.find((b) => b.id === selectedBookId);
    return book?.series_id ?? null;
  }, [books, selectedBookId]);

  const label = useMemo(() => {
    if (!activeSeriesId) return null;
    const name = seriesNames[activeSeriesId];
    if (!name) return null;

    // Compute centroid of this series
    const seriesBooks = books.filter((b) => b.series_id === activeSeriesId);
    if (seriesBooks.length < MIN_BOOKS_FOR_LABEL) return null;

    let cx = 0, cy = 0, cz = 0;
    for (const b of seriesBooks) {
      const [wx, wy, wz] = bookWorldPos(b, regionAnchorMap, spacingMultiplier);
      cx += wx; cy += wy; cz += wz;
    }
    cx /= seriesBooks.length;
    cy /= seriesBooks.length;
    cz /= seriesBooks.length;

    return { name, cx, cy, cz, count: seriesBooks.length };
  }, [activeSeriesId, books, seriesNames, regionAnchorMap, spacingMultiplier]);

  if (!label) return null;

  return (
    <Html
      position={[label.cx, label.cy + 0.04, label.cz]}
      center
      distanceFactor={1.2}
      style={{ pointerEvents: "none" }}
    >
      <div className="text-center select-none animate-in fade-in duration-300">
        <p className="text-[10px] italic font-medium whitespace-nowrap" style={{ color: "#F59E0B" }}>
          {label.name}
        </p>
        <p className="text-[8px] whitespace-nowrap" style={{ color: "#F59E0B", opacity: 0.5 }}>
          {label.count} books
        </p>
      </div>
    </Html>
  );
}
