"use client";

import { useMemo } from "react";
import { useNebula } from "@/lib/nebula/nebula-context";

export function NebulaPathStats() {
  const { userPath, showPath, books } = useNebula();

  const stats = useMemo(() => {
    if (userPath.length === 0) return null;

    const total = userPath.length;
    const withDates = userPath.filter((n) => n.readAt);
    const chronologyPct = Math.round((withDates.length / total) * 100);

    // Span: days between first and last dated entry
    let spanDays: number | null = null;
    if (withDates.length >= 2) {
      const first = new Date(withDates[0].readAt!).getTime();
      const last = new Date(withDates[withDates.length - 1].readAt!).getTime();
      spanDays = Math.round((last - first) / (1000 * 60 * 60 * 24));
    }

    // Gaps (only populated where both endpoints have dates)
    const gaps = userPath.map((n) => n.daysGapToNext).filter((g): g is number => g !== null);
    const avgGap = gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
    const longestGap = gaps.length > 0 ? Math.max(...gaps) : null;

    // Regions touched — join via books map
    const bookRegionMap = new Map(books.map((b) => [b.id, b.region_id]));
    const regionIds = new Set<string>();
    for (const n of userPath) {
      const rid = bookRegionMap.get(n.bookId);
      if (rid) regionIds.add(rid);
    }

    return {
      total,
      chronologyPct,
      spanDays,
      avgGap,
      longestGap,
      regionsTouched: regionIds.size,
    };
  }, [userPath, books]);

  if (!showPath || !stats) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-lg px-4 py-2">
        <div className="flex items-center gap-5 text-[10px]">
          <Stat label="Books" value={stats.total.toString()} />
          <Stat label="Chronology" value={`${stats.chronologyPct}%`} />
          {stats.spanDays !== null && <Stat label="Span" value={formatDays(stats.spanDays)} />}
          {stats.avgGap !== null && <Stat label="Avg pause" value={formatDays(stats.avgGap)} />}
          {stats.longestGap !== null && <Stat label="Longest" value={formatDays(stats.longestGap)} />}
          <Stat label="Regions" value={stats.regionsTouched.toString()} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-white/80 font-medium tabular-nums">{value}</span>
      <span className="text-[9px] text-white/30 uppercase tracking-wider">{label}</span>
    </div>
  );
}

function formatDays(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = days / 365;
  return years >= 10 ? `${Math.round(years)}y` : `${years.toFixed(1)}y`;
}
