"use client";

import dynamic from "next/dynamic";

const NebulaView = dynamic(
  () => import("@/components/nebula/NebulaView").then((m) => ({ default: m.NebulaView })),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-muted animate-pulse">Loading Nebula...</p>
    </div>
  )}
);

export default function NebulaPage() {
  return (
    <div className="w-full h-full">
      <NebulaView />
    </div>
  );
}
