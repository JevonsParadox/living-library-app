"use client";

/**
 * Bottom-right slider that controls how spread out books are within their
 * region (galaxy). Region anchors stay fixed in world space — only the
 * book-to-anchor offset is multiplied. Pure render-time; no DB writes.
 *
 * Performance: BookCloud has ~12k instanced meshes whose positions are
 * recomputed when spacingMultiplier changes — visibly one-frame jank. So we
 * keep a local "dragValue" for the live slider feedback and only commit the
 * value to the context (triggering rerender) on pointer release.
 */

import { useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";

const MIN = 0.5;
// Books are placed within their region cloud at offset ≤ 0.35 (region radius).
// At 5× the offset becomes 1.75 — still within reasonable bounds before
// books from one region start visually overlapping a neighbour. Headroom is
// safe because regions don't move with the slider.
const MAX = 5;
const STEP = 0.1;

export function SpacingSlider() {
  const { spacingMultiplier, setSpacingMultiplier } = useNebula();
  const [dragValue, setDragValue] = useState(spacingMultiplier);

  // Keep local in sync if context changes externally (e.g., reset button).
  useEffect(() => {
    setDragValue(spacingMultiplier);
  }, [spacingMultiplier]);

  const commit = () => {
    if (dragValue !== spacingMultiplier) {
      setSpacingMultiplier(dragValue);
    }
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 pointer-events-auto">
      <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 backdrop-blur-md px-3 py-1.5">
        <Maximize2 size={11} className="text-white/40 shrink-0" />
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={dragValue}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="w-32 accent-amber-300/60 cursor-pointer"
          aria-label="Planet spread within each galaxy"
          title="Spread books within each galaxy. Regions stay put; only the books move."
        />
        <span className="text-[10px] text-white/50 tabular-nums w-8 text-right">
          {dragValue.toFixed(1)}×
        </span>
      </div>
    </div>
  );
}
