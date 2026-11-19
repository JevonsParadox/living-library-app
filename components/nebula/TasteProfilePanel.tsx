"use client";

import { useCallback } from "react";
import { Compass } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";

export function TasteProfilePanel() {
  const { tasteProfile, setFlyTarget, setSelectedBook } = useNebula();

  const handleCenterOnMe = useCallback(() => {
    if (!tasteProfile) return;
    setSelectedBook(null);
    // Centroid is already in world space (computed via bookWorldPos).
    setFlyTarget({
      x: tasteProfile.centroid.x,
      y: tasteProfile.centroid.y,
      z: tasteProfile.centroid.z,
      cameraDistance: 1.2,
    });
  }, [tasteProfile, setFlyTarget, setSelectedBook]);

  if (!tasteProfile) return null;

  return (
    <div className="absolute top-24 left-4 z-10 pointer-events-auto">
      <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 min-w-[200px]">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[9px] text-white/30 uppercase tracking-widest">Your constellation</p>
          <button
            onClick={handleCenterOnMe}
            className="text-[9px] text-amber-300/60 hover:text-amber-300 flex items-center gap-1"
            title="Fly camera to your shelf centroid"
          >
            <Compass size={9} />
            Center
          </button>
        </div>

        <div className="space-y-1">
          {tasteProfile.topRegions.map((r) => (
            <div key={r.regionId} className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: r.colorHex }}
              />
              <span className="text-[10px] text-white/60 truncate flex-1">{r.name}</span>
              <span className="text-[9px] text-white/30 tabular-nums">{r.count}</span>
            </div>
          ))}
        </div>

        <StateBreakdownBar breakdown={tasteProfile.stateBreakdown} />

        <p className="text-[9px] text-white/25 mt-1.5 pt-1.5 border-t border-white/5">
          {tasteProfile.totalBooks} books · {tasteProfile.regionsTouched} regions
        </p>
      </div>
    </div>
  );
}

const STATE_SEGMENTS = [
  { key: "read" as const, color: "#FFD700", label: "Read" },
  { key: "reading" as const, color: "#34D399", label: "Reading" },
  { key: "nextUp" as const, color: "#F59E0B", label: "Up next" },
  { key: "onShelf" as const, color: "#38BDF8", label: "On shelf" },
  { key: "wishlist" as const, color: "#C084FC", label: "Wishlist" },
];

function StateBreakdownBar({
  breakdown,
}: {
  breakdown: { read: number; reading: number; nextUp: number; onShelf: number; wishlist: number };
}) {
  const total = STATE_SEGMENTS.reduce((sum, s) => sum + breakdown[s.key], 0);
  if (total === 0) return null;

  return (
    <div className="mt-2 pt-1.5 border-t border-white/5">
      <div className="flex h-1 rounded-full overflow-hidden bg-white/5">
        {STATE_SEGMENTS.map((seg) => {
          const count = breakdown[seg.key];
          if (count === 0) return null;
          return (
            <div
              key={seg.key}
              style={{ background: seg.color, width: `${(count / total) * 100}%` }}
              title={`${seg.label}: ${count}`}
            />
          );
        })}
      </div>
    </div>
  );
}
