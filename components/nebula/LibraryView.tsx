"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";
import type { UserBookState } from "@/lib/nebula/nebula-types";
import type { NbBookWithCoords } from "@/lib/nebula/fetch-nebula-data";

interface RowConfig {
  key: "reading" | "next_up" | "read" | "on_shelf" | "wishlist";
  label: string;
  color: string;
  hint: string;
  /** Sort applied to the row's books */
  sort: (a: BookWithState, b: BookWithState) => number;
  /** Date pill for the card, if any */
  datePill?: (state: UserBookState) => string | null;
}

interface BookWithState {
  book: NbBookWithCoords;
  state: UserBookState;
}

const ROWS: RowConfig[] = [
  {
    key: "reading",
    label: "Reading",
    color: "#34D399",
    hint: "Mark a book as Reading to see it here",
    sort: (a, b) => dateDesc(a.state.startedAt, b.state.startedAt),
    datePill: (s) => s.startedAt ? `Started ${formatDate(s.startedAt)}` : null,
  },
  {
    key: "next_up",
    label: "Up Next",
    color: "#F59E0B",
    hint: "Queue books as Up Next to see them here",
    sort: byTitle,
  },
  {
    key: "read",
    label: "Read",
    color: "#FFD700",
    hint: "Books you've finished show up here, with their read date",
    sort: (a, b) => dateDesc(a.state.readAt, b.state.readAt),
    datePill: (s) => s.readAt ? formatDate(s.readAt) : null,
  },
  {
    key: "on_shelf",
    label: "On Shelf",
    color: "#38BDF8",
    hint: "Owned books that aren't in another bucket live here",
    sort: byTitle,
  },
  {
    key: "wishlist",
    label: "Wishlist",
    color: "#C084FC",
    hint: "Add books you want to buy as Wishlist",
    sort: byTitle,
  },
];

export function LibraryView() {
  const { books, userLibrary } = useNebula();
  const router = useRouter();

  // Bucket books by row key in one pass
  const buckets = useMemo(() => {
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const result: Record<RowConfig["key"], BookWithState[]> = {
      reading: [], next_up: [], read: [], on_shelf: [], wishlist: [],
    };
    for (const [bookId, state] of userLibrary) {
      const book = bookMap.get(bookId);
      if (!book) continue;
      const key = bucketKey(state);
      result[key].push({ book, state });
    }
    // Sort each bucket per its config
    for (const row of ROWS) {
      result[row.key].sort(row.sort);
    }
    return result;
  }, [books, userLibrary]);

  const totalBooks = userLibrary.size;

  const handleCardClick = (bookId: string) => {
    router.push(`/nebula?book=${encodeURIComponent(bookId)}`);
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-[#05070A] text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">My Library</h1>
            <p className="text-xs text-muted mt-0.5">Your books, sorted by where you are with them.</p>
          </div>
          <p className="text-xs text-muted/70 tabular-nums">{totalBooks} books</p>
        </div>

        {totalBooks === 0 ? (
          <div className="rounded-xl border border-border/30 bg-surface-solid/40 p-8 text-center">
            <p className="text-sm text-muted">Your library is empty.</p>
            <p className="text-xs text-muted/60 mt-1">Add books from the Sci-Fi tab to get started.</p>
          </div>
        ) : (
          ROWS.map((row) => (
            <Row
              key={row.key}
              config={row}
              books={buckets[row.key]}
              onCardClick={handleCardClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  config,
  books,
  onCardClick,
}: {
  config: RowConfig;
  books: BookWithState[];
  onCardClick: (bookId: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
        <h2 className="text-sm font-semibold text-foreground">{config.label}</h2>
        <span className="text-[10px] text-muted/70 tabular-nums">
          {books.length === 0 ? "—" : `${books.length} book${books.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {books.length === 0 ? (
        <p className="text-[11px] text-muted/40 italic pl-3.5">{config.hint}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {books.map(({ book, state }) => (
            <Card
              key={book.id}
              book={book}
              state={state}
              accent={config.color}
              datePill={config.datePill?.(state) ?? null}
              onClick={() => onCardClick(book.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Card({
  book,
  accent,
  datePill,
  onClick,
}: {
  book: NbBookWithCoords;
  state: UserBookState;
  accent: string;
  datePill: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-36 text-left rounded-lg bg-foreground/3 border border-border/10 p-2 hover:bg-foreground/5 hover:border-border/30 transition-colors"
    >
      <div className="flex gap-2">
        {book.cover_image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
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
      {datePill && (
        <p className="text-[9px] mt-1 truncate" style={{ color: accent + "BF" }}>
          {datePill}
        </p>
      )}
    </button>
  );
}

// --- helpers ---

function bucketKey(state: UserBookState): RowConfig["key"] {
  if (state.ownership === "wishlist") return "wishlist";
  switch (state.status) {
    case "read": return "read";
    case "reading": return "reading";
    case "next_up": return "next_up";
    case "unread":
    default: return "on_shelf";
  }
}

function byTitle(a: BookWithState, b: BookWithState): number {
  return a.book.title.toLowerCase().localeCompare(b.book.title.toLowerCase());
}

function dateDesc(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(b).getTime() - new Date(a).getTime();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
