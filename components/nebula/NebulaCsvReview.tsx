"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Check, X, Sparkles } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";
import {
  addToNebulaShelf,
  createShellFromProvider,
  previewAddCandidates,
  type MatchResult,
  type MatchHint,
} from "@/app/(nebula)/nebula/actions";
import type { BookOwnership, BookStatus } from "@/lib/nebula/nebula-types";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";
import { bookWorldPos } from "@/lib/nebula/world-scale";
import { AddToUniverseDialog } from "./AddToUniverseDialog";

/** Time between successive shelf-commits in the flythrough cascade.
 *  Each addToShelf fires the D1 ignition pulse, so the stagger reads as a
 *  visible wave of book ignitions sweeping across the cluster. */
const COMMIT_STAGGER_MS = 150;
/** Time to wait after setFlyTarget before starting the ignition cascade —
 *  matches the natural lerp convergence of CameraController. */
const CAMERA_GLIDE_MS = 1200;
/** Camera offset from cluster centroid during the flythrough. Cluster cloud
 *  is ~1.4 world units; 2.5 frames it with breathing room and lands cleanly
 *  in the "constellation" zoom band (STAR_THRESHOLD = 2, GALAXY_THRESHOLD = 5),
 *  avoiding a borderline flip into "star" mode where some HUD/edge layers
 *  treat the view differently. */
const CLUSTER_CAMERA_DISTANCE = 2.5;
/** Time to dwell on the freshly-lit cluster before flying out to a wider
 *  view that frames it in galaxy context. */
const SETTLE_DWELL_MS = 800;
/** Wider camera offset for the settle target, so the user sees the new
 *  cluster + neighbouring region planets together rather than being stuck
 *  inside their own constellation. */
const SETTLE_CAMERA_DISTANCE = 5;
/** Fraction of the centroid distance to use as the settle anchor — half
 *  way back toward origin frames the cluster on one side with the wider
 *  galaxy visible on the other. */
const SETTLE_PULLBACK = 0.5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Props {
  matches: MatchResult[];
  onDone: () => void;
}

interface StateOption {
  label: string;
  ownership: BookOwnership;
  status: BookStatus;
  color: string;
}

const STATE_OPTIONS: StateOption[] = [
  { label: "Read", ownership: "owned", status: "read", color: "#FFD700" },
  { label: "Reading", ownership: "owned", status: "reading", color: "#34D399" },
  { label: "Up next", ownership: "owned", status: "next_up", color: "#F59E0B" },
  { label: "On shelf", ownership: "owned", status: "unread", color: "#38BDF8" },
  { label: "Wishlist", ownership: "wishlist", status: "unread", color: "#C084FC" },
];

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * Carries the data needed to render a newly-resolved row in the matched list:
 * the freshly-created book identifiers + the original CSV extraction so the
 * "via batch" row still shows what the CSV had on it (state hint, raw title).
 *
 * Also holds a full NbBookWithCoords snapshot so `handleAddAll` can:
 *   1. Call addBookToGalaxy defensively at commit time (no-op if the book
 *      already made it into state.books during batch, fixes it if not).
 *   2. Compute the cluster centroid + spatial sort for the flythrough
 *      without re-querying state.books — which would be a stale-closure
 *      hazard given the cascade runs across setState boundaries.
 */
interface ResolvedShellRow {
  bookId: string;
  title: string;
  authorName: string | null;
  coverUrl: string | null;
  extractedTitle: string;
  extractedAuthor?: string;
  hint?: MatchHint;
  galaxyBook: NbBookWithCoords;
}

export function NebulaCsvReview({ matches, onDone }: Props) {
  const {
    addToShelf,
    addBookToGalaxy,
    books,
    setFlyTarget,
    regionAnchorMap,
    spacingMultiplier,
  } = useNebula();
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const m of matches) {
      if (m.matchedBookId && m.confidence >= 0.5) s.add(m.matchedBookId);
    }
    return s;
  });
  const [bulkState, setBulkState] = useState<StateOption>(STATE_OPTIONS[3]); // default On shelf
  const [perRowState, setPerRowState] = useState<Map<string, MatchHint>>(new Map());
  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  /** Index of the unmatched row whose AddToUniverseDialog is open. */
  const [addUniverseFor, setAddUniverseFor] = useState<number | null>(null);
  /**
   * Unmatched indices that were resolved this session (via batch or manual
   * AddToUniverseDialog). The shell creation + galaxy insertion already
   * happened — the row is no longer "unmatched" — but the book is NOT yet
   * on the user's shelf. The user reviews / categorises in the matched list
   * and the single "Add N books" button at the top is the only shelf-commit.
   */
  const [resolvedShells, setResolvedShells] = useState<Map<number, ResolvedShellRow>>(new Map());
  /** Indices that the batch loop tried and failed (no candidate / network error). */
  const [batchFailed, setBatchFailed] = useState<Set<number>>(new Set());
  /** Live progress for the batch "add all to universe" loop. Null when idle. */
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  /** Cancel flag — checked inside the batch loop between awaits so the user
   *  can stop a long ingestion without losing rows already resolved. */
  const batchCancelRef = useRef(false);

  const toggle = useCallback((bookId: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }, []);

  const setRowState = useCallback((bookId: string, hint: MatchHint) => {
    setPerRowState((m) => {
      const next = new Map(m);
      next.set(bookId, hint);
      return next;
    });
  }, []);

  // Effective hint per row: explicit override > CSV-inferred hint > bulk
  const effectiveHint = useCallback((bookId: string, csvHint: MatchHint | undefined): MatchHint => {
    const override = perRowState.get(bookId);
    return {
      ownership: override?.ownership ?? csvHint?.ownership ?? bulkState.ownership,
      status: override?.status ?? csvHint?.status ?? bulkState.status,
      readAt: override?.readAt ?? csvHint?.readAt ?? null,
    };
  }, [perRowState, bulkState]);

  /**
   * Commit the selected books to the user's shelf as a "flythrough":
   *   1. Build a positioned list of every selected book (state.books first,
   *      resolvedShells as a fallback so newly-batched books are never lost).
   *   2. Fly the camera to the cluster centroid so the user is looking at
   *      the right region before anything lights up.
   *   3. Wait for the camera glide (CAMERA_GLIDE_MS).
   *   4. Sort books inner→outer by distance to centroid so the ignition
   *      wave radiates instead of jumping randomly.
   *   5. Iterate with COMMIT_STAGGER_MS between books: optimistic addToShelf
   *      (fires the D1 ignition pulse + cascade), server write fired
   *      in parallel without blocking the visual cadence.
   *   6. Set done; onDone closes the panel.
   */
  const handleAddAll = useCallback(async () => {
    setAdding(true);

    // Build positioned list. `books` reflects every addBookToGalaxy call from
    // the batch loop, but we fall back to galaxyBook on resolvedShells for
    // any row that somehow didn't make it (defensive — shouldn't happen).
    const resolvedByBookId = new Map<string, ResolvedShellRow>();
    for (const r of resolvedShells.values()) resolvedByBookId.set(r.bookId, r);

    const positioned: Array<{ bookId: string; book: NbBookWithCoords; wx: number; wy: number; wz: number }> = [];
    for (const bookId of selected) {
      const fromGalaxy = books.find((b) => b.id === bookId);
      const book = fromGalaxy ?? resolvedByBookId.get(bookId)?.galaxyBook;
      if (!book) continue; // unreachable in normal flow; safe-skip
      const [wx, wy, wz] = bookWorldPos(book, regionAnchorMap, spacingMultiplier);
      positioned.push({ bookId, book, wx, wy, wz });
    }

    if (positioned.length === 0) {
      setAdding(false);
      setDone(true);
      setTimeout(onDone, 1500);
      return;
    }

    // Centroid + camera fly.
    let sx = 0, sy = 0, sz = 0;
    for (const p of positioned) { sx += p.wx; sy += p.wy; sz += p.wz; }
    const cx = sx / positioned.length;
    const cy = sy / positioned.length;
    const cz = sz / positioned.length;
    setFlyTarget({ x: cx, y: cy, z: cz, cameraDistance: CLUSTER_CAMERA_DISTANCE });
    await sleep(CAMERA_GLIDE_MS);

    // Inner→outer wave order.
    positioned.sort((a, b) => {
      const da = (a.wx - cx) ** 2 + (a.wy - cy) ** 2 + (a.wz - cz) ** 2;
      const db = (b.wx - cx) ** 2 + (b.wy - cy) ** 2 + (b.wz - cz) ** 2;
      return da - db;
    });

    // Staggered commit cascade.
    for (const { bookId, book } of positioned) {
      // Belt-and-braces: no-op if already in state.books, recovery if not.
      addBookToGalaxy(book);

      const csvHint = matches.find((m) => m.matchedBookId === bookId)?.hint
        ?? resolvedByBookId.get(bookId)?.hint;
      const eff = effectiveHint(bookId, csvHint);
      const opts = {
        ownership: eff.ownership,
        status: eff.status,
        read_at: eff.status === "read" ? eff.readAt ?? null : null,
      };
      // Optimistic UI first — fires the D1 ignition pulse + neighbour cascade.
      addToShelf(bookId, { ownership: opts.ownership, status: opts.status, readAt: opts.read_at });
      // Server write fires in parallel so cascade timing isn't gated on
      // network latency. addToShelf's optimistic state survives until the
      // next page load; if a write fails, refresh reflects truth (same
      // robustness as the prior implementation, which also didn't check).
      void addToNebulaShelf(bookId, opts);

      await sleep(COMMIT_STAGGER_MS);
    }

    // Two-stage settle: dwell on the lit cluster briefly, then pull back to
    // a wider frame so the user sees their new region in galaxy context
    // (and isn't stuck inside their own constellation with nowhere obvious
    // to navigate to next).
    await sleep(SETTLE_DWELL_MS);
    setFlyTarget({
      x: cx * SETTLE_PULLBACK,
      y: cy * SETTLE_PULLBACK,
      z: cz * SETTLE_PULLBACK,
      cameraDistance: SETTLE_CAMERA_DISTANCE,
    });

    setAdding(false);
    setDone(true);
    setTimeout(onDone, 1500);
  }, [
    selected,
    matches,
    effectiveHint,
    addToShelf,
    addBookToGalaxy,
    books,
    setFlyTarget,
    regionAnchorMap,
    spacingMultiplier,
    resolvedShells,
    onDone,
  ]);

  /**
   * Background ingestion for every unmatched, unresolved row in one click.
   * For each row: previewAddCandidates → auto-pick the first candidate
   * (OpenLibrary is preferred over Google Books in the provider order) →
   * createShellFromProvider → the new book joins the universe and the row
   * migrates into the matched list with its CSV hint preserved. Shelf
   * commit happens later via the single "Add N books" button at the top,
   * keeping the matched + newly-resolved flow symmetric.
   * Cancellable between awaits; rows that fail to find a candidate are
   * recorded in batchFailed so the user can still pick them manually.
   */
  const handleBatchAddUnmatched = useCallback(async () => {
    const unmatchedRows = matches.filter((m) => !m.matchedBookId);
    const toProcess: Array<{ idx: number; row: MatchResult }> = [];
    for (let i = 0; i < unmatchedRows.length; i++) {
      if (resolvedShells.has(i)) continue;
      toProcess.push({ idx: i, row: unmatchedRows[i] });
    }
    if (toProcess.length === 0) return;

    batchCancelRef.current = false;
    setBatchFailed(new Set());
    setBatchProgress({ current: 0, total: toProcess.length });

    for (let j = 0; j < toProcess.length; j++) {
      if (batchCancelRef.current) break;
      const { idx, row } = toProcess[j];
      setBatchProgress({ current: j + 1, total: toProcess.length });

      try {
        const { candidates } = await previewAddCandidates(row.extractedTitle, row.extractedAuthor);
        if (batchCancelRef.current) break;
        if (candidates.length === 0) {
          setBatchFailed((s) => new Set(s).add(idx));
          continue;
        }

        const { shell, error } = await createShellFromProvider(candidates[0]);
        if (batchCancelRef.current) break;
        if (error || !shell) {
          setBatchFailed((s) => new Set(s).add(idx));
          continue;
        }

        // A shell without coordinates can't be positioned, can't be lit, and
        // would render as an invisible "ghost" on the shelf. Treat it as a
        // failure so the row stays in the unmatched list where the user can
        // pick a candidate manually.
        if (shell.x === null || shell.y === null || shell.z === null) {
          setBatchFailed((s) => new Set(s).add(idx));
          continue;
        }

        const galaxyBook: NbBookWithCoords = {
          id: shell.bookId,
          title: shell.title,
          canonical_genre: shell.canonicalGenre,
          popularity_score: shell.popularityScore,
          engagement_score: 0,
          cover_image_url: shell.coverUrl,
          publication_year: shell.publicationYear,
          page_count: shell.pageCount,
          author_name: shell.authorName,
          series_id: shell.seriesId,
          series_order: shell.seriesOrder,
          x: shell.x,
          y: shell.y,
          z: shell.z,
          region_id: shell.regionId,
        };
        // Unconditional — handles both fresh shells and dedupe hits where
        // an existing book may have been filtered out of initial state.books
        // due to a missing coords row at first load.
        addBookToGalaxy(galaxyBook);

        // Move the row into the matched list with its CSV hint preserved.
        // No addToNebulaShelf / addToShelf here — those run when the user
        // clicks "Add N books to shelf" at the top, just like for the
        // originally-matched rows.
        setResolvedShells((m) => {
          const next = new Map(m);
          next.set(idx, {
            bookId: shell.bookId,
            title: shell.title,
            authorName: shell.authorName,
            coverUrl: shell.coverUrl,
            extractedTitle: row.extractedTitle,
            extractedAuthor: row.extractedAuthor,
            hint: row.hint,
            galaxyBook,
          });
          return next;
        });
        setSelected((s) => new Set(s).add(shell.bookId));
      } catch {
        setBatchFailed((s) => new Set(s).add(idx));
      }
    }
    setBatchProgress(null);
  }, [matches, resolvedShells, addBookToGalaxy]);

  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  if (done) {
    return <p className="text-[10px] text-emerald-400">Added {selected.size} books to shelf</p>;
  }

  const matchedFromCsv = matches.filter((m) => m.matchedBookId);
  const unmatched = matches.filter((m) => !m.matchedBookId);

  // Promote newly-resolved unmatched rows into a synthetic MatchResult so they
  // render in the matched list with the same controls (state picker,
  // selection checkbox) as the originally-matched rows.
  const matchedFromBatch: MatchResult[] = [];
  for (const shell of resolvedShells.values()) {
    matchedFromBatch.push({
      matchedBookId: shell.bookId,
      matchedTitle: shell.title,
      matchedAuthor: shell.authorName,
      matchedCover: shell.coverUrl,
      confidence: 1.0,
      extractedTitle: shell.extractedTitle,
      extractedAuthor: shell.extractedAuthor,
      hint: shell.hint,
    });
  }
  const allMatched: MatchResult[] = [...matchedFromCsv, ...matchedFromBatch];

  const remainingUnmatched = unmatched.length - resolvedShells.size;
  const totalMatched = allMatched.length;
  const isBatching = batchProgress !== null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted">
          {totalMatched} matched · {remainingUnmatched} unmatched
        </p>
        <button
          onClick={handleAddAll}
          disabled={adding || selected.size === 0 || isBatching}
          className="px-2.5 py-1 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding..." : `Add ${selected.size} books`}
        </button>
      </div>

      {/* Bulk default — applies to rows without an explicit override or CSV hint */}
      <div>
        <p className="text-[9px] text-muted/50 mb-1">Default for all (click any row to override)</p>
        <div className="flex flex-wrap gap-1">
          {STATE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setBulkState(opt)}
              className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
                bulkState.label === opt.label
                  ? "bg-white/15 text-white border-white/20"
                  : "bg-white/5 text-white/40 border-white/10 hover:text-white/70"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: opt.color }} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto space-y-1">
        {allMatched.map((m) => {
          const bookId = m.matchedBookId!;
          const eff = effectiveHint(bookId, m.hint);
          const display = displayFor(eff);
          const source: SourceTag =
            perRowState.has(bookId) ? "override"
            : (m.hint?.ownership || m.hint?.status) ? "csv"
            : "bulk";
          return (
            <div key={bookId}>
              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-foreground/3 border border-border/10">
                <button
                  onClick={() => toggle(bookId)}
                  className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                    selected.has(bookId)
                      ? "bg-emerald-500/30 border-emerald-500/50 text-emerald-300"
                      : "border-border/30 text-transparent"
                  }`}
                >
                  <Check size={10} />
                </button>
                {m.matchedCover && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={m.matchedCover} alt="" className="w-5 h-7 rounded object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate">{m.matchedTitle}</p>
                  <p className="text-[10px] text-muted truncate">
                    <span className="truncate">{m.matchedAuthor}</span>
                    <span className="text-accent ml-1">{Math.round(m.confidence * 100)}%</span>
                  </p>
                </div>
                <button
                  onClick={() => setOpenPickerFor((cur) => cur === bookId ? null : bookId)}
                  className="shrink-0 flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border transition-colors hover:bg-white/5"
                  style={{ borderColor: display.color + (source === "override" ? "55" : "22"), color: source === "override" ? "white" : "rgba(255,255,255,0.6)" }}
                  title={
                    source === "override" ? "Override (click to change)"
                    : source === "csv" ? "From CSV (click to override)"
                    : "Bulk default (click to override)"
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: display.color }} />
                  {display.label}
                  {eff.status === "read" && eff.readAt ? <span className="opacity-60">· {shortDate(eff.readAt)}</span> : null}
                </button>
              </div>

              {openPickerFor === bookId && (
                <RowStatePicker
                  initial={eff}
                  onSave={(hint) => { setRowState(bookId, hint); setOpenPickerFor(null); }}
                  onCancel={() => setOpenPickerFor(null)}
                />
              )}
            </div>
          );
        })}

        {unmatched.length > 0 && remainingUnmatched > 0 && (
          <div className="pt-1 border-t border-border/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-muted/70">
                Be the first to add these to the universe
              </p>
              {isBatching ? (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-accent/80">
                    Adding {batchProgress!.current} of {batchProgress!.total}…
                  </span>
                  <button
                    onClick={cancelBatch}
                    className="text-[9px] text-white/40 hover:text-white/70 px-1.5 py-0.5"
                  >
                    Cancel
                  </button>
                </div>
              ) : remainingUnmatched > 0 ? (
                <button
                  onClick={handleBatchAddUnmatched}
                  disabled={adding}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50 transition-colors"
                >
                  <Sparkles size={10} />
                  Add all ({remainingUnmatched})
                </button>
              ) : null}
            </div>
            {unmatched.map((m, i) => {
              // Resolved rows already moved into the matched list above.
              if (resolvedShells.has(i)) return null;
              const isFailed = batchFailed.has(i);
              return (
                <div key={i} className="flex items-center gap-2 p-1 text-[10px]">
                  <X size={10} className={`shrink-0 ${isFailed ? "text-amber-400/60" : "text-muted/40"}`} />
                  <span className={`truncate flex-1 ${isFailed ? "text-amber-400/70" : "text-muted/40"}`}>
                    {m.extractedTitle}
                    {m.extractedAuthor ? ` — ${m.extractedAuthor}` : ""}
                    {isFailed ? <span className="ml-1 text-[9px] text-amber-400/50">(no candidate — pick manually)</span> : null}
                  </span>
                  {!isBatching && (
                    <button
                      onClick={() => setAddUniverseFor(i)}
                      className="flex items-center gap-1 text-[9px] text-accent/80 hover:text-accent shrink-0"
                    >
                      <Sparkles size={9} />
                      Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {addUniverseFor !== null && unmatched[addUniverseFor] && (
        <AddToUniverseDialog
          seed={{
            kind: "title",
            title: unmatched[addUniverseFor].extractedTitle,
            author: unmatched[addUniverseFor].extractedAuthor,
          }}
          onClose={() => setAddUniverseFor(null)}
          onAdded={(shell) => {
            const idx = addUniverseFor;
            if (idx === null) return;
            // Same shape as the batch path: skip null-coord shells (they'd
            // render as invisible ghosts on the shelf), otherwise add to
            // galaxy unconditionally and stash full coord data in
            // resolvedShells for the commit-time flythrough.
            if (shell.x === null || shell.y === null || shell.z === null) {
              setBatchFailed((s) => new Set(s).add(idx));
              setAddUniverseFor(null);
              return;
            }
            const galaxyBook: NbBookWithCoords = {
              id: shell.bookId,
              title: shell.title,
              canonical_genre: shell.canonicalGenre,
              popularity_score: shell.popularityScore,
              engagement_score: 0,
              cover_image_url: shell.coverUrl,
              publication_year: shell.publicationYear,
              page_count: shell.pageCount,
              author_name: shell.authorName,
              series_id: shell.seriesId,
              series_order: shell.seriesOrder,
              x: shell.x,
              y: shell.y,
              z: shell.z,
              region_id: shell.regionId,
            };
            addBookToGalaxy(galaxyBook);
            const row = unmatched[idx];
            setResolvedShells((m) => {
              const next = new Map(m);
              next.set(idx, {
                bookId: shell.bookId,
                title: shell.title,
                authorName: shell.authorName,
                coverUrl: shell.coverUrl,
                extractedTitle: row.extractedTitle,
                extractedAuthor: row.extractedAuthor,
                hint: row.hint,
                galaxyBook,
              });
              return next;
            });
            setSelected((s) => new Set(s).add(shell.bookId));
            setAddUniverseFor(null);
          }}
        />
      )}
    </div>
  );
}

// --- Row-level state picker (inline popover anchored under the row) ---

type SourceTag = "override" | "csv" | "bulk";

function RowStatePicker({
  initial,
  onSave,
  onCancel,
}: {
  initial: MatchHint;
  onSave: (hint: MatchHint) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<MatchHint>(initial);
  const [draftDate, setDraftDate] = useState<string>(initial.readAt ?? TODAY());
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click cancels
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  const pick = (opt: StateOption) => {
    setDraft({ ownership: opt.ownership, status: opt.status, readAt: opt.status === "read" ? draftDate : null });
  };

  const handleSave = () => {
    if (draft.status === "read") {
      onSave({ ownership: draft.ownership, status: "read", readAt: draftDate || TODAY() });
    } else {
      onSave({ ownership: draft.ownership, status: draft.status, readAt: null });
    }
  };

  const isReadPicked = draft.status === "read";

  return (
    <div ref={ref} className="mt-1 ml-6 mr-1 p-2 rounded-lg bg-[#0A0E14]/95 border border-white/10 space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {STATE_OPTIONS.map((opt) => {
          const active = (opt.ownership === draft.ownership) && (opt.status === draft.status);
          return (
            <button
              key={opt.label}
              onClick={() => pick(opt)}
              className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
                active ? "border-white/30 text-white" : "border-white/10 text-white/40 hover:text-white/70"
              }`}
              style={active ? { background: opt.color + "22", borderColor: opt.color + "55" } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: opt.color }} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {isReadPicked && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            max={TODAY()}
            className="text-[10px] bg-surface-solid border border-border/30 rounded px-1.5 py-0.5 text-foreground flex-1 min-w-0"
          />
        </div>
      )}

      <div className="flex justify-end gap-1">
        <button onClick={onCancel} className="text-[9px] text-white/40 hover:text-white/70 px-1.5 py-0.5">
          Cancel
        </button>
        <button onClick={handleSave} className="text-[9px] text-amber-300 hover:text-amber-200 px-1.5 py-0.5 flex items-center gap-0.5">
          <Check size={10} /> Save
        </button>
      </div>
    </div>
  );
}

// --- helpers ---

function displayFor(hint: MatchHint): { label: string; color: string } {
  if (hint.ownership === "wishlist") return { label: "Wishlist", color: "#C084FC" };
  switch (hint.status) {
    case "read": return { label: "Read", color: "#FFD700" };
    case "reading": return { label: "Reading", color: "#34D399" };
    case "next_up": return { label: "Up next", color: "#F59E0B" };
    case "unread":
    default: return { label: "On shelf", color: "#38BDF8" };
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
