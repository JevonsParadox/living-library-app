"use client";

import { useNebula } from "@/lib/nebula/nebula-context";
import type { SimilarMode } from "@/lib/nebula/nebula-context";
import { BookOpen } from "lucide-react";
import { useMemo } from "react";
import { AddBookMenu } from "./AddBookMenu";

export function SimilarReadsTray() {
  const {
    selectedBook, similarBookIds, books, flyToBook, isOnShelf,
    similarMode, setSimilarMode, similarLoading,
  } = useNebula();

  const similarBooks = useMemo(() => {
    if (!selectedBook || similarBookIds.length === 0) return [];
    const bookMap = new Map(books.map((b) => [b.id, b]));
    return similarBookIds.map((id) => bookMap.get(id)).filter((b): b is NonNullable<typeof b> => Boolean(b));
  }, [selectedBook, similarBookIds, books]);

  // Show an empty tray (with the toggle) while semantic results are loading
  // so the user can switch back to spatial without the tray disappearing.
  if (!selectedBook) return null;
  if (similarBooks.length === 0 && !similarLoading) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="backdrop-blur-md bg-surface-solid/80 rounded-xl border border-sky-400/20 p-3 inline-block">
        <div className="flex items-center justify-between gap-4 mb-2">
          <p className="text-[10px] text-sky-300/80 font-semibold">Similar reads</p>
          <SimilarModeToggle mode={similarMode} onChange={setSimilarMode} loading={similarLoading} />
        </div>
        <div className="flex gap-2 min-h-[68px]">
          {similarBooks.length === 0 && similarLoading && (
            <p className="text-[10px] text-white/40 italic self-center px-2">Finding nearby reads…</p>
          )}
          {similarBooks.map((book) => {
            const onShelf = isOnShelf(book.id);
            return (
              <div
                key={book.id}
                onClick={() => flyToBook(book.id)}
                className="flex-shrink-0 w-36 rounded-lg bg-foreground/3 border border-border/10 p-2 text-left hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <div className="flex gap-2">
                  {book.cover_image_url ? (
                    <img
                      src={book.cover_image_url}
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
                    <p className="text-[10px] text-foreground truncate leading-tight">{book.title}</p>
                    <p className="text-[9px] text-muted truncate">{book.author_name ?? ""}</p>
                  </div>
                </div>
                {!onShelf && (
                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                    <AddBookMenu bookId={book.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MODE_OPTIONS: Array<{ value: SimilarMode; label: string; title: string }> = [
  { value: "spatial", label: "Nearby", title: "Closest in 3D space" },
  { value: "semantic", label: "By feel", title: "Closest in embedding similarity" },
];

function SimilarModeToggle({
  mode,
  onChange,
  loading,
}: {
  mode: SimilarMode;
  onChange: (m: SimilarMode) => void;
  loading: boolean;
}) {
  return (
    <div className="flex gap-1 items-center">
      {loading && (
        <div className="w-2 h-2 border border-sky-400/30 border-t-sky-300 rounded-full animate-spin mr-1" />
      )}
      {MODE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={opt.title}
          className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
            mode === opt.value
              ? "bg-sky-500/20 text-sky-200 border border-sky-400/30"
              : "bg-white/5 text-white/40 border border-white/10 hover:text-white/70"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
