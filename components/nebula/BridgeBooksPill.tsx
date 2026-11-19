"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, GitMerge } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";
import { getBridgeBooksForLibrary, type BridgeResult } from "@/app/(nebula)/nebula/actions";
import { AddBookMenu } from "./AddBookMenu";

/**
 * Opt-in left-rail pill that surfaces books bridging two of the user's
 * most-populated owned regions. Sits above the compass. Default collapsed.
 *
 * Visibility rules:
 *   - Hidden entirely if user has < 2 owned regions (no_owned, single_region)
 *   - Otherwise pill always visible; expanded panel shows cards or "no
 *     candidates yet" message depending on the action result
 */
export function BridgeBooksPill() {
  const { selectedBookId, userLibrary } = useNebula();
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch when library size changes meaningfully
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBridgeBooksForLibrary().then((data) => {
      if (cancelled) return;
      setResult(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userLibrary.size]);

  // Outside-click closes the expanded panel
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (loading) return null;
  if (!result) return null;
  // Don't render the pill when there's no library to bridge
  if (result.status === "no_owned" || result.status === "single_region") return null;

  // Stack above the compass, mirroring its selectedBookId offset
  const bottomClass = selectedBookId ? "bottom-56" : "bottom-32";
  const count = result.bridges.length;

  return (
    <div ref={ref} className={`absolute ${bottomClass} left-4 z-20 pointer-events-auto transition-all`}>
      {open && <BridgePanel result={result} />}
      <button
        onClick={() => setOpen((o) => !o)}
        className="backdrop-blur-md bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 transition-colors"
      >
        <GitMerge size={11} className="text-fuchsia-300/80" />
        <span className="text-[10px] text-white/60">Bridges</span>
        {count > 0 && (
          <span className="text-[9px] text-fuchsia-300/80 tabular-nums">{count}</span>
        )}
        {open
          ? <ChevronDown size={10} className="text-white/30" />
          : <ChevronUp size={10} className="text-white/30" />}
      </button>
    </div>
  );
}

function BridgePanel({ result }: { result: BridgeResult }) {
  const { isOnShelf, flyToBook } = useNebula();

  const headerSubtitle = result.fromRegion && result.toRegion
    ? `${result.fromRegion} ↔ ${result.toRegion}`
    : null;

  return (
    <div className="mb-1 backdrop-blur-md bg-surface-solid/85 border border-fuchsia-400/20 rounded-lg p-3 max-w-[360px]">
      <p className="text-[10px] text-fuchsia-300/80 font-semibold">Bridges your taste</p>
      {headerSubtitle && (
        <p className="text-[9px] text-white/40 mb-2">{headerSubtitle}</p>
      )}

      {result.status === "no_candidates" && (
        <p className="text-[10px] text-white/40 italic">No bridges found between these regions yet.</p>
      )}

      {result.status === "ok" && (
        <div className="flex gap-2 mt-1.5 overflow-x-auto pb-1">
          {result.bridges.map((b) => (
            <div
              key={b.bookId}
              onClick={() => flyToBook(b.bookId)}
              className="flex-shrink-0 w-32 rounded-lg bg-foreground/3 border border-border/10 p-2 text-left hover:bg-foreground/5 transition-colors cursor-pointer"
            >
              <div className="flex gap-2">
                {b.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={b.coverUrl}
                    alt=""
                    className="w-7 h-10 rounded object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-7 h-10 rounded bg-surface-solid border border-border/20 flex items-center justify-center shrink-0">
                    <BookOpen size={8} className="text-muted/30" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-foreground truncate leading-tight">{b.title}</p>
                  <p className="text-[9px] text-muted truncate">{b.authorName ?? ""}</p>
                </div>
              </div>
              {!isOnShelf(b.bookId) && (
                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                  <AddBookMenu bookId={b.bookId} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
