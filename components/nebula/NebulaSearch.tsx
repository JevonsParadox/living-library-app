"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Search, Sparkles } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";
import {
  emitPopularitySignal,
  searchBooksByTitle,
  type BookSearchHit,
  type CreatedShell,
} from "@/app/(nebula)/nebula/actions";
import { AddToUniverseDialog } from "./AddToUniverseDialog";

interface DisplayHit {
  id: string;
  title: string;
  author_name: string | null;
  canonical_genre: string | null;
  source: "memory" | "server";
}

const MIN_LOCAL_RESULTS = 3;
const SEARCH_EMIT_THROTTLE_MS = 1500;

export function NebulaSearch() {
  const { books, flyToBook, addBookToGalaxy } = useNebula();
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [serverHits, setServerHits] = useState<BookSearchHit[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitRef = useRef<{ query: string; at: number }>({ query: "", at: 0 });

  const handleChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim().toLowerCase());
      setShowResults(value.trim().length >= 2);
    }, 200);
  }, []);

  // In-memory (instant) filter over the pre-loaded books.
  const localResults = useMemo<DisplayHit[]>(() => {
    if (debouncedQuery.length < 2) return [];
    return books
      .filter((b) => {
        const q = debouncedQuery;
        return (
          b.title.toLowerCase().includes(q) ||
          (b.author_name?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 8)
      .map((b) => ({
        id: b.id,
        title: b.title,
        author_name: b.author_name ?? null,
        canonical_genre: b.canonical_genre ?? null,
        source: "memory" as const,
      }));
  }, [books, debouncedQuery]);

  // Server fallback — only fires if in-memory returns few results.
  useEffect(() => {
    if (debouncedQuery.length < 2 || localResults.length >= MIN_LOCAL_RESULTS) {
      // Queue the clear outside the effect body to avoid the sync-setState rule.
      const clear = () => setServerHits((prev) => (prev.length === 0 ? prev : []));
      const id = setTimeout(clear, 0);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    searchBooksByTitle(debouncedQuery, 10).then(({ results }) => {
      if (cancelled) return;
      setServerHits(results);
    });
    return () => { cancelled = true; };
  }, [debouncedQuery, localResults.length]);

  // Merge local + server, dedupe by id, cap at 8.
  const mergedResults = useMemo<DisplayHit[]>(() => {
    const seen = new Set(localResults.map((r) => r.id));
    const extra: DisplayHit[] = serverHits
      .filter((h) => !seen.has(h.id))
      .map((h) => ({
        id: h.id,
        title: h.title,
        author_name: h.authorName,
        canonical_genre: h.canonicalGenre,
        source: "server" as const,
      }));
    return [...localResults, ...extra].slice(0, 8);
  }, [localResults, serverHits]);

  // Throttle search_hit signal: one emit per distinct non-empty query.
  useEffect(() => {
    if (!debouncedQuery || mergedResults.length === 0) return;
    const now = Date.now();
    if (
      lastEmitRef.current.query === debouncedQuery &&
      now - lastEmitRef.current.at < SEARCH_EMIT_THROTTLE_MS
    ) return;
    lastEmitRef.current = { query: debouncedQuery, at: now };
    // Only emit for the top hit — noise control.
    void emitPopularitySignal(mergedResults[0].id, "search_hit");
  }, [debouncedQuery, mergedResults]);

  const handleSelect = useCallback(
    (bookId: string) => {
      flyToBook(bookId);
      setQuery("");
      setShowResults(false);
      setDebouncedQuery("");
    },
    [flyToBook]
  );

  const handleAdded = useCallback(
    (shell: CreatedShell) => {
      if (shell.justCreated && shell.x !== null && shell.y !== null && shell.z !== null) {
        addBookToGalaxy({
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
        });
      }
      flyToBook(shell.bookId);
      setQuery("");
      setShowResults(false);
      setDebouncedQuery("");
    },
    [addBookToGalaxy, flyToBook]
  );

  const showCTA =
    showResults &&
    debouncedQuery.length >= 3 &&
    mergedResults.length === 0 &&
    !showAddDialog;

  return (
    <div className="absolute top-10 left-4 z-20 w-64 pointer-events-auto">
      <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 backdrop-blur-md px-3 py-1.5">
        <Search size={12} className="text-white/50 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => debouncedQuery.length >= 2 && setShowResults(true)}
          placeholder="Search books..."
          className="flex-1 bg-transparent text-xs text-white placeholder:text-white/30 focus:outline-none"
        />
      </div>

      {/* Dismiss dropdown on outside click — renders behind dropdown */}
      {showResults && (
        <div className="fixed inset-0" onClick={() => setShowResults(false)} />
      )}

      {showResults && mergedResults.length > 0 && (
        <div className="relative z-30 mt-1 rounded-lg border border-white/10 bg-[#0A0E14]/95 backdrop-blur-md shadow-lg max-h-64 overflow-y-auto">
          {mergedResults.map((book) => (
            <button
              key={book.id}
              onClick={() => handleSelect(book.id)}
              className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-foreground/5 transition-colors border-b border-border/10 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground truncate">{book.title}</p>
                <p className="text-[10px] text-muted truncate">{book.author_name}</p>
              </div>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: book.canonical_genre?.startsWith("fantasy") ? "#34D399" : "#3B82F6" }}
              />
            </button>
          ))}
        </div>
      )}

      {showCTA && (
        <div className="relative z-30 mt-1 rounded-lg border border-border/30 bg-surface-solid/90 backdrop-blur-md px-3 py-2 space-y-1">
          <p className="text-[10px] text-muted">No matches in your universe.</p>
          <button
            onClick={() => setShowAddDialog(true)}
            className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            <Sparkles size={10} />
            Add “{query}” to the universe
          </button>
        </div>
      )}

      {showAddDialog && (
        <AddToUniverseDialog
          seed={{ kind: "title", title: query }}
          onClose={() => setShowAddDialog(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
