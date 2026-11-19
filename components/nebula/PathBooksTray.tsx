"use client";

import { useMemo, useState } from "react";
import { BookOpen, Check, X } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";
import type { PathSortMode } from "@/lib/nebula/path-sort";
import { setNebulaBookDate } from "@/app/(nebula)/nebula/actions";

const SORT_OPTIONS: { value: PathSortMode; label: string }[] = [
  { value: "constellation", label: "Constellation" },
  { value: "chronological", label: "Chronological" },
  { value: "alphabetical", label: "Alphabetical" },
];

export function PathBooksTray() {
  const {
    showPath, userPath, sortedPath, pathSortMode, setPathSortMode,
    books, flyToBook, selectedBookId, setUserPathBookDate, userLibrary,
  } = useNebula();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState<string>("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  // Currently reading books — tiny badge above the tray
  const currentlyReading = useMemo(() => {
    const result: Array<{ bookId: string; title: string }> = [];
    for (const [bookId, st] of userLibrary) {
      if (st.ownership === "owned" && st.status === "reading") {
        const book = bookMap.get(bookId);
        if (book) result.push({ bookId, title: book.title });
      }
    }
    return result;
  }, [userLibrary, bookMap]);

  if (!showPath || userPath.length === 0) return null;

  // Stack above SimilarReadsTray when both visible
  const bottomClass = selectedBookId ? "bottom-32" : "bottom-16";

  const startEdit = (bookId: string, currentReadAt: string | null) => {
    setEditingId(bookId);
    setDraftDate(currentReadAt ? currentReadAt.slice(0, 10) : "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftDate("");
  };

  const saveDate = async (bookId: string) => {
    if (!draftDate) return;
    setSavingId(bookId);
    const res = await setNebulaBookDate(bookId, draftDate);
    if (res.success) {
      setUserPathBookDate(bookId, draftDate);
      setEditingId(null);
      setDraftDate("");
    } else {
      console.error("[PathBooksTray] failed to set date:", res.error);
    }
    setSavingId(null);
  };

  return (
    <div
      className={`absolute ${bottomClass} left-1/2 -translate-x-1/2 z-20 pointer-events-auto max-w-[calc(100%-2rem)] flex flex-col items-center gap-1.5`}
    >
      {currentlyReading.length > 0 && (
        <div className="backdrop-blur-md bg-emerald-500/10 border border-emerald-400/20 rounded-full px-3 py-1 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-200/80">Currently reading:</span>
          {currentlyReading.map((r, i) => (
            <button
              key={r.bookId}
              onClick={() => flyToBook(r.bookId)}
              className="text-[10px] text-white/80 hover:text-white truncate max-w-[180px]"
            >
              {r.title}{i < currentlyReading.length - 1 ? "," : ""}
            </button>
          ))}
        </div>
      )}

      <div className="backdrop-blur-md bg-surface-solid/80 rounded-xl border border-amber-500/20 p-3">
        <div className="flex items-center justify-between gap-4 mb-2">
          <p className="text-[10px] text-amber-300/80 font-semibold">On your path</p>
          <div className="flex gap-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPathSortMode(opt.value)}
                className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
                  pathSortMode === opt.value
                    ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
                    : "bg-white/5 text-white/40 border border-white/10 hover:text-white/70"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sortedPath.map((node) => {
            const meta = bookMap.get(node.bookId);
            const isEditing = editingId === node.bookId;
            const isSaving = savingId === node.bookId;
            return (
              <div
                key={node.bookId}
                onClick={() => !isEditing && flyToBook(node.bookId)}
                className={`flex-shrink-0 w-36 rounded-lg bg-foreground/3 border border-border/10 p-2 text-left transition-colors ${
                  isEditing ? "border-amber-400/40" : "hover:bg-foreground/5 cursor-pointer"
                }`}
              >
                <div className="flex gap-2">
                  {meta?.cover_image_url ? (
                    <img
                      src={meta.cover_image_url}
                      alt=""
                      className="w-8 h-11 rounded object-cover shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-8 h-11 rounded bg-surface-solid border border-border/20 flex items-center justify-center shrink-0">
                      <BookOpen size={8} className="text-muted/30" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-foreground truncate leading-tight">{node.title}</p>
                    <p className="text-[9px] text-muted truncate">{meta?.author_name ?? ""}</p>
                  </div>
                </div>

                {isEditing ? (
                  <div className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                      max={new Date().toISOString().slice(0, 10)}
                      className="text-[9px] bg-surface-solid border border-border/30 rounded px-1 py-0.5 text-foreground flex-1 min-w-0"
                      disabled={isSaving}
                    />
                    <button
                      onClick={() => saveDate(node.bookId)}
                      disabled={isSaving || !draftDate}
                      className="p-0.5 text-amber-300 hover:text-amber-200 disabled:opacity-30"
                      aria-label="Save date"
                    >
                      <Check size={10} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={isSaving}
                      className="p-0.5 text-white/40 hover:text-white/70"
                      aria-label="Cancel"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : node.readAt ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(node.bookId, node.readAt); }}
                    className="mt-1 text-[9px] text-amber-300/60 hover:text-amber-300 truncate w-full text-left"
                  >
                    {formatReadDate(node.readAt)}
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(node.bookId, null); }}
                    className="mt-1 text-[9px] text-white/40 hover:text-amber-300 truncate w-full text-left"
                  >
                    Set date
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatReadDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
