"use client";

/**
 * Top-of-view pill that toggles between the 3D R3F scene and the 2D
 * force-directed graph. Persists the choice to localStorage via the context's
 * setViewMode setter.
 *
 * Top-centre placement keeps it discoverable without crowding search (top-left)
 * or the action buttons (top-right).
 */

import { Box, Network } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";

export function ViewModeToggle() {
  const { viewMode, setViewMode } = useNebula();

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
      role="tablist"
      aria-label="Render mode"
    >
      <div className="flex items-center gap-0.5 rounded-full border border-white/15 bg-white/5 backdrop-blur-md p-0.5">
        <ModeButton
          active={viewMode === "3d"}
          onClick={() => setViewMode("3d")}
          icon={<Box size={11} />}
          label="3D"
          title="Render as a 3D semantic galaxy (default)"
        />
        <ModeButton
          active={viewMode === "2d"}
          onClick={() => setViewMode("2d")}
          icon={<Network size={11} />}
          label="2D"
          title="Render as a force-directed graph"
        />
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] transition-colors ${
        active
          ? "bg-white/15 text-white"
          : "text-white/45 hover:text-white/80 hover:bg-white/5"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
