"use client";

import { useNebula } from "@/lib/nebula/nebula-context";
import { BookOpen } from "lucide-react";
import { AddBookMenu } from "./AddBookMenu";

export function RecommendationTray() {
  const { recommendations, showPath, flyToBook, isOnShelf, selectedBookId } = useNebula();

  if (!showPath || recommendations.length === 0) return null;

  // When a book is also selected, the Similar Reads tray claims bottom-4.
  // Shift this tray up so both are visible.
  const bottomClass = selectedBookId ? "bottom-32" : "bottom-16";

  return (
    <div className={`absolute ${bottomClass} left-1/2 -translate-x-1/2 z-20 pointer-events-auto max-w-[calc(100%-2rem)]`}>
      <div className="backdrop-blur-md bg-surface-solid/80 rounded-xl border border-amber-500/20 p-3">
        <p className="text-[10px] text-amber-300/70 font-semibold mb-2">Recommended for you</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {recommendations.map((rec) => {
            const onShelf = isOnShelf(rec.bookId);
            return (
              <div
                key={rec.bookId}
                onClick={() => flyToBook(rec.bookId)}
                className="flex-shrink-0 w-36 rounded-lg bg-foreground/3 border border-border/10 p-2 text-left hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <div className="flex gap-2">
                  {rec.coverUrl ? (
                    <img
                      src={rec.coverUrl}
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
                    <p className="text-[10px] text-foreground truncate leading-tight">{rec.title}</p>
                    <p className="text-[9px] text-muted truncate">{rec.authorName}</p>
                  </div>
                </div>
                <p className="text-[9px] text-amber-300/50 mt-1 truncate">{rec.reason}</p>
                {!onShelf && (
                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                    <AddBookMenu bookId={rec.bookId} />
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
