"use client";

/**
 * Three-axis compass showing where the camera is pointing in the
 * semantic coordinate system books are placed in. The seed pipeline
 * (scripts/nebula/refine-coordinates.ts:5-7) maps each book's offset
 * from its region anchor along three axes:
 *
 *   X: fantasy_scifi_score      (Fantasy ←→ Sci-Fi)
 *   Y: softness_hardness_score  (Soft    ←→ Hard)
 *   Z: intimacy_epic_score      (Intimate ←→ Epic)
 *
 * The compass projects the camera's normalised forward vector onto
 * each axis: forward.x in [-1, 1] is the X-axis component, etc. A
 * fully axis-aligned camera reads ±1 on one axis and 0 on the other
 * two; a diagonal view splits across all three.
 *
 * Three rows, each with pole labels + a horizontal track + a needle
 * dot at (value + 1) / 2 along the track. Replaces the previous
 * "facing-by-region" compass.
 */

import { useEffect, useState } from "react";
import { useNebula } from "@/lib/nebula/nebula-context";

const UPDATE_INTERVAL_MS = 150;
/** Only re-render when any axis component shifts by more than this since
 *  the last commit. Keeps the needles steady when the camera is barely
 *  moving without making them feel sticky on slow pans. */
const DEAD_ZONE = 0.02;

interface AxisRow {
  /** Short pole label shown on the left of the track. */
  negativePole: string;
  /** Short pole label shown on the right. */
  positivePole: string;
  /** Camera-forward component on this axis, in [-1, 1]. */
  value: number;
}

export function NebulaCompass() {
  const { cameraDirectionRef, selectedBookId } = useNebula();
  const [axes, setAxes] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const tick = () => {
      const { forward } = cameraDirectionRef.current;
      setAxes((prev) => {
        if (
          Math.abs(prev.x - forward.x) < DEAD_ZONE &&
          Math.abs(prev.y - forward.y) < DEAD_ZONE &&
          Math.abs(prev.z - forward.z) < DEAD_ZONE
        ) {
          return prev;
        }
        return { x: forward.x, y: forward.y, z: forward.z };
      });
    };

    const id = setInterval(tick, UPDATE_INTERVAL_MS);
    tick();
    return () => clearInterval(id);
  }, [cameraDirectionRef]);

  // Lift compass above the Similar Reads tray when a book is selected.
  const bottomClass = selectedBookId ? "bottom-28" : "bottom-4";

  const rows: AxisRow[] = [
    { negativePole: "Fantasy", positivePole: "Sci-Fi", value: axes.x },
    { negativePole: "Soft", positivePole: "Hard", value: axes.y },
    { negativePole: "Intimate", positivePole: "Epic", value: axes.z },
  ];

  return (
    <div className={`absolute ${bottomClass} left-4 z-20 pointer-events-auto transition-all`}>
      <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 min-w-[200px]">
        <p className="text-[9px] text-white/30 uppercase tracking-widest mb-2">Heading</p>
        <div className="space-y-2">
          {rows.map((row) => (
            <AxisIndicator key={row.negativePole} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AxisIndicator({ row }: { row: AxisRow }) {
  // Map [-1, 1] → [0%, 100%] for the needle's left position. A neutral
  // forward (value 0) lands the needle at 50% — dead centre.
  const clamped = Math.max(-1, Math.min(1, row.value));
  const needleLeftPct = ((clamped + 1) / 2) * 100;

  return (
    <div className="flex items-center gap-2 text-[9px] text-white/50">
      <span className="w-12 text-right whitespace-nowrap">{row.negativePole}</span>
      <div className="relative flex-1 h-[2px] bg-white/10 rounded-full">
        <span
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white/80"
          style={{ left: `${needleLeftPct}%` }}
        />
      </div>
      <span className="w-12 whitespace-nowrap">{row.positivePole}</span>
    </div>
  );
}
