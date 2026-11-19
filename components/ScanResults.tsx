"use client";

import { useState, useCallback } from "react";
import { BookOpen, Check, X } from "lucide-react";
import type { MatchedBook } from "@/app/actions/match-spines";

interface ScanResultsProps {
  books: MatchedBook[];
  onConfirm: (selected: MatchedBook[]) => void;
  onCancel: () => void;
}

const confidenceColors: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-red-400",
};

export function ScanResults({ books, onConfirm, onCancel }: ScanResultsProps) {
  const [selections, setSelections] = useState<boolean[]>(
    books.map((b) => b.selected)
  );

  const selectedCount = selections.filter(Boolean).length;

  const toggleAll = useCallback(
    (value: boolean) => setSelections(books.map(() => value)),
    [books]
  );

  const toggle = useCallback(
    (index: number) =>
      setSelections((s) => {
        const next = [...s];
        next[index] = !next[index];
        return next;
      }),
    []
  );

  const handleConfirm = useCallback(() => {
    const selected = books.filter((_, i) => selections[i]);
    onConfirm(selected);
  }, [books, selections, onConfirm]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">
            Found {books.length} books
          </p>
          <p className="text-[10px] text-muted">
            {selectedCount} selected
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => toggleAll(true)}
            className="text-[10px] text-muted hover:text-foreground transition-colors"
          >
            Select all
          </button>
          <button
            onClick={() => toggleAll(false)}
            className="text-[10px] text-muted hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Book list */}
      <div className="max-h-72 overflow-y-auto space-y-0.5 pr-1">
        {books.map((book, i) => (
          <button
            key={`${book.spine.title}-${i}`}
            onClick={() => toggle(i)}
            className={`flex items-center gap-2 w-full text-left p-2 rounded-lg transition-colors ${
              selections[i] ? "bg-foreground/5" : "bg-transparent opacity-50"
            } hover:bg-foreground/8`}
          >
            {/* Checkbox */}
            <div
              className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                selections[i]
                  ? "bg-accent/20 border-accent/50"
                  : "border-border/50"
              }`}
            >
              {selections[i] && <Check size={10} className="text-accent" />}
            </div>

            {/* Cover thumbnail */}
            <div className="w-7 h-10 shrink-0 rounded bg-surface-solid border border-border/20 flex items-center justify-center overflow-hidden">
              {book.match?.coverUrl ? (
                <img
                  src={book.match.coverUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <BookOpen size={8} className="text-muted/30" />
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-foreground truncate">
                {book.match?.title ?? book.spine.title}
              </p>
              <p className="text-[10px] text-muted truncate">
                {book.match?.author ?? book.spine.author}
                {book.match?.publishedYear ? ` · ${book.match.publishedYear}` : ""}
              </p>
            </div>

            {/* Confidence + match status */}
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <span className={`text-[9px] ${confidenceColors[book.spine.confidence] ?? "text-muted"}`}>
                {book.spine.confidence}
              </span>
              {!book.match && (
                <span className="text-[9px] text-red-400/60">no match</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 text-xs rounded-lg bg-foreground/5 text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          className="flex-1 py-2 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Add {selectedCount} books
        </button>
      </div>
    </div>
  );
}
