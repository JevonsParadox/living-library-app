"use client";

import { useEffect, useState, useCallback } from "react";
import { useNebula } from "@/lib/nebula/nebula-context";
import {
  emitPopularitySignal,
  getEnrichmentStatus,
  getNebulaBookDetail,
  removeFromNebulaShelf,
  setNebulaBookDate,
  updateNebulaBookState,
  type NbBookDetail,
} from "@/app/(nebula)/nebula/actions";
import { useNebulaBookRealtime } from "@/lib/nebula/realtime";
import { formatAttribution } from "@/lib/nebula/attribution";
import { X, Check, Sparkles } from "lucide-react";
import type { BookOwnership, BookStatus } from "@/lib/nebula/nebula-types";
import { AddBookMenu } from "./AddBookMenu";

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

// Per-session throttle: don't emit 'view' signals more than once per book per session.
const viewedThisSession = new Set<string>();

export function BookDetailPanel() {
  const { selectedBook, setSelectedBook, getBookState, updateBookState, removeFromShelf } = useNebula();
  const [detail, setDetail] = useState<NbBookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [metadataStatus, setMetadataStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedBook) {
      // Deferred clear — avoids the sync-setState-in-effect rule.
      const id = setTimeout(() => {
        setDetail(null);
        setMetadataStatus(null);
      }, 0);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const startLoading = setTimeout(() => !cancelled && setLoading(true), 0);
    Promise.all([
      getNebulaBookDetail(selectedBook.id),
      getEnrichmentStatus(selectedBook.id),
    ]).then(([d, status]) => {
      if (cancelled) return;
      setDetail(d);
      setMetadataStatus(status?.metadata_status ?? null);
      setLoading(false);
    });

    // Emit a 'view' popularity signal once per book per session.
    if (!viewedThisSession.has(selectedBook.id)) {
      viewedThisSession.add(selectedBook.id);
      // fire-and-forget; failures are non-critical.
      void emitPopularitySignal(selectedBook.id, "view");
    }

    return () => {
      cancelled = true;
      clearTimeout(startLoading);
    };
  }, [selectedBook]);

  // Subscribe to realtime updates so enrichment worker writes land in-place.
  useNebulaBookRealtime(selectedBook?.id ?? null, {
    onBookUpdate: (patch) => {
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              description: patch.description ?? prev.description,
              publication_year: patch.publication_year ?? prev.publication_year,
              page_count: patch.page_count ?? prev.page_count,
              cover_image_url: patch.cover_image_url ?? prev.cover_image_url,
            }
          : prev,
      );
    },
    onStatusUpdate: (patch) => {
      if (patch.metadata_status) setMetadataStatus(patch.metadata_status);
    },
  });

  if (!selectedBook) return null;

  const libraryState = getBookState(selectedBook.id);

  const genreLabel = selectedBook.canonical_genre
    ?.replace(":", " — ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="absolute right-4 top-4 bottom-18 w-72 z-20 pointer-events-auto">
      <div className="backdrop-blur-md bg-surface-solid/80 rounded-xl border border-border/50 p-4 space-y-3 max-h-full overflow-y-auto">
        {/* Close button */}
        <button
          onClick={() => setSelectedBook(null)}
          className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>

        {/* Cover */}
        {selectedBook.cover_image_url && (
          <div className="flex justify-center">
            <img
              src={selectedBook.cover_image_url}
              alt={selectedBook.title}
              className="w-20 h-auto rounded shadow-lg"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}

        {/* Title + Author */}
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-tight">
            {selectedBook.title}
          </h3>
          {selectedBook.author_name && (
            <p className="text-xs text-muted mt-0.5">{selectedBook.author_name}</p>
          )}
        </div>

        {/* Series */}
        {detail?.series_name && (
          <p className="text-xs text-accent/70">
            {detail.series_name}
            {detail.series_order ? ` #${detail.series_order}` : ""}
          </p>
        )}

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 text-[10px] text-muted">
          {genreLabel && (
            <span className="px-2 py-0.5 rounded-full bg-foreground/5 border border-border/30">
              {genreLabel}
            </span>
          )}
          {selectedBook.publication_year && (
            <span className="px-2 py-0.5 rounded-full bg-foreground/5 border border-border/30">
              {selectedBook.publication_year}
            </span>
          )}
          {selectedBook.page_count && (
            <span className="px-2 py-0.5 rounded-full bg-foreground/5 border border-border/30">
              {selectedBook.page_count}p
            </span>
          )}
        </div>

        {/* Description — prefer LLM-paraphrased short_description to avoid
            displaying raw copyrighted text from external providers. */}
        {loading && (
          <p className="text-[10px] text-muted animate-pulse">Loading...</p>
        )}
        {!loading && !detail?.short_description && metadataStatus &&
          (metadataStatus === "shell" || metadataStatus === "enriching" || metadataStatus === "stale") && (
            <div className="flex items-center gap-1.5 text-[10px] text-accent/70 animate-pulse">
              <Sparkles size={10} />
              <span>Enriching…</span>
            </div>
          )}
        {detail?.short_description && (
          <p className="text-xs text-muted/80 leading-relaxed">
            {detail.short_description}
          </p>
        )}

        {/* Sources — per-book attribution derived from external_ids.provenance. */}
        {detail?.external_ids && <SourcesBlock externalIds={detail.external_ids} />}

        {/* Library state — pills if in library, AddBookMenu if not */}
        <LibrarySection
          bookId={selectedBook.id}
          state={libraryState}
          onUpdate={(partial) => updateBookState(selectedBook.id, partial)}
          onRemove={() => removeFromShelf(selectedBook.id)}
        />

        {/* Popularity */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted">Popularity</span>
            <span className="text-foreground">{selectedBook.popularity_score.toFixed(0)}/100</span>
          </div>
          <div className="h-1 bg-foreground/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent/60 rounded-full"
              style={{ width: `${selectedBook.popularity_score}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Library section: pills + date input + remove ---

function LibrarySection({
  bookId,
  state,
  onUpdate,
  onRemove,
}: {
  bookId: string;
  state: ReturnType<typeof useNebula>["getBookState"] extends (id: string) => infer R ? R : never;
  onUpdate: (partial: { ownership?: BookOwnership; status?: BookStatus; readAt?: string | null }) => void;
  onRemove: () => void;
}) {
  // All hooks declared unconditionally — Rules of Hooks. We branch on `state`
  // only in the JSX after every hook has been called.
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);
  const [draftDate, setDraftDate] = useState<string>("");

  const activeLabel: string =
    state?.ownership === "wishlist"
      ? "Wishlist"
      : state?.status === "read" ? "Read"
      : state?.status === "reading" ? "Reading"
      : state?.status === "next_up" ? "Up next"
      : "On shelf";

  const handlePillClick = useCallback(async (opt: StateOption) => {
    if (opt.label === activeLabel) return;
    setSavingLabel(opt.label);
    const res = await updateNebulaBookState(bookId, { ownership: opt.ownership, status: opt.status });
    if (res.success) {
      onUpdate({ ownership: opt.ownership, status: opt.status });
    } else {
      console.error("[BookDetailPanel] failed to update state:", res.error);
    }
    setSavingLabel(null);
  }, [activeLabel, bookId, onUpdate]);

  const handleDateSave = useCallback(async () => {
    if (!draftDate) return;
    const res = await setNebulaBookDate(bookId, draftDate);
    if (res.success) {
      onUpdate({ readAt: draftDate });
      setEditingDate(false);
    }
  }, [bookId, draftDate, onUpdate]);

  const handleRemove = useCallback(async () => {
    const res = await removeFromNebulaShelf(bookId);
    if (res.success) onRemove();
  }, [bookId, onRemove]);

  // Not in library yet — show AddBookMenu (hooks above all still ran)
  if (!state) {
    return (
      <div className="pt-1 border-t border-border/20">
        <p className="text-[9px] text-white/40 uppercase tracking-widest mb-1.5">Add to library</p>
        <AddBookMenu bookId={bookId} size="md" />
      </div>
    );
  }

  return (
    <div className="pt-1 border-t border-border/20 space-y-1.5">
      <p className="text-[9px] text-white/40 uppercase tracking-widest">In your library</p>

      <div className="flex flex-wrap gap-1">
        {STATE_OPTIONS.map((opt) => {
          const active = opt.label === activeLabel;
          return (
            <button
              key={opt.label}
              onClick={() => handlePillClick(opt)}
              disabled={savingLabel !== null}
              className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
                active
                  ? "border-white/30 text-white"
                  : "border-white/10 text-white/40 hover:text-white/70"
              }`}
              style={active ? { background: opt.color + "22", borderColor: opt.color + "55" } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: opt.color }} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Read-date editor only when status is 'read' */}
      {state.status === "read" && state.ownership === "owned" && (
        <div className="flex items-center gap-2 text-[10px]">
          {editingDate ? (
            <>
              <input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="text-[10px] bg-surface-solid border border-border/30 rounded px-1.5 py-0.5 text-foreground"
              />
              <button onClick={handleDateSave} className="text-amber-300 hover:text-amber-200" aria-label="Save date">
                <Check size={10} />
              </button>
              <button onClick={() => setEditingDate(false)} className="text-white/40 hover:text-white/70" aria-label="Cancel">
                <X size={10} />
              </button>
            </>
          ) : (
            <button
              onClick={() => { setDraftDate(state.readAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)); setEditingDate(true); }}
              className="text-amber-300/70 hover:text-amber-300"
            >
              {state.readAt ? `Read ${formatReadDate(state.readAt)}` : "Add date"}
            </button>
          )}
        </div>
      )}

      <button onClick={handleRemove} className="text-[9px] text-white/30 hover:text-red-400 transition-colors">
        Remove from library
      </button>
    </div>
  );
}

function formatReadDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// --- Sources attribution block ---

function SourcesBlock({ externalIds }: { externalIds: Record<string, unknown> }) {
  const items = formatAttribution(externalIds);
  if (items.length === 0) return null;
  return (
    <div className="pt-1 border-t border-border/20">
      <p className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Sources</p>
      <ul className="text-[10px] text-muted space-y-0.5">
        {items.map((s) => (
          <li key={s.id}>
            {s.href ? (
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground/80 underline"
              >
                {s.label}
              </a>
            ) : (
              s.label
            )}
            {s.licence ? <span className="text-muted/60"> · {s.licence}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
