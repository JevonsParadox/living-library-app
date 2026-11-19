"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { X, Search, Upload, Check, Camera, ScanLine } from "lucide-react";
import { useNebula } from "@/lib/nebula/nebula-context";
import {
  matchNebulaBooks,
  searchBooksByTitle,
  type BookSearchHit,
  type MatchResult,
  type MatchHint,
} from "@/app/(nebula)/nebula/actions";
import { NebulaCsvReview } from "./NebulaCsvReview";
import { NebulaSpineScan } from "./NebulaSpineScan";
import { NebulaBarcodeScan } from "./NebulaBarcodeScan";
import { AddBookMenu } from "./AddBookMenu";

interface SearchRow {
  id: string;
  title: string;
  author_name: string | null;
}

const MIN_LOCAL_RESULTS = 3;

type Mode = "search" | "csv" | "scan" | "barcode" | null;

export function NebulaUploadPanel() {
  const { showUploadPanel, setShowUploadPanel, books, isOnShelf, flyToBook } = useNebula();
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // CSV state
  const [csvMatches, setCsvMatches] = useState<MatchResult[] | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // In-memory filter over the books already loaded into the universe.
  const localResults = useMemo<SearchRow[]>(() => {
    if (query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return books
      .filter((b) => b.title.toLowerCase().includes(q) || (b.author_name?.toLowerCase().includes(q) ?? false))
      .slice(0, 10)
      .map((b) => ({ id: b.id, title: b.title, author_name: b.author_name ?? null }));
  }, [books, query]);

  // Server fallback — fires when local results are sparse so new users (or
  // any query that misses the in-memory subset) can still find books in
  // the shared universe catalog. Mirrors the pattern used by NebulaSearch.
  const [serverHits, setServerHits] = useState<BookSearchHit[]>([]);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || localResults.length >= MIN_LOCAL_RESULTS) {
      if (serverHits.length > 0) setServerHits([]);
      return;
    }
    let cancelled = false;
    searchBooksByTitle(q, 10).then(({ results }) => {
      if (cancelled) return;
      setServerHits(results);
    });
    return () => { cancelled = true; };
    // serverHits.length intentionally omitted: it's the value being managed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, localResults.length]);

  // Merge local + server hits, dedupe by id, cap at 10.
  const searchResults = useMemo<SearchRow[]>(() => {
    const seen = new Set(localResults.map((r) => r.id));
    const extra: SearchRow[] = serverHits
      .filter((h) => !seen.has(h.id))
      .map((h) => ({ id: h.id, title: h.title, author_name: h.authorName }));
    return [...localResults, ...extra].slice(0, 10);
  }, [localResults, serverHits]);

  const handleAdded = useCallback((bookId: string) => {
    flyToBook(bookId);
    setMessage("Added to library");
    setTimeout(() => setMessage(null), 2000);
  }, [flyToBook]);

  const handleCsvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvLoading(true);
    const text = await file.text();
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setMessage("CSV is empty");
      setCsvLoading(false);
      return;
    }

    const headerCols = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
    const colIdx = (matcher: (h: string) => boolean) => headerCols.findIndex(matcher);

    // Required + optional columns. Matches Goodreads exports too.
    const titleIdx = colIdx((h) => h.includes("title"));
    const authorIdx = colIdx((h) => h === "author" || h.startsWith("author "));
    // Prefer ISBN13 if present, fall back to ISBN
    const isbn13Idx = colIdx((h) => h.includes("isbn13") || h.includes("isbn 13") || h.includes("isbn_13"));
    const isbnIdx = isbn13Idx >= 0 ? isbn13Idx : colIdx((h) => h.includes("isbn"));
    const dateReadIdx = colIdx((h) => h.includes("date read") || h.includes("date_read") || h === "read date");
    const exclusiveShelfIdx = colIdx((h) => h.includes("exclusive shelf") || h.includes("exclusive_shelf"));
    const bookshelvesIdx = exclusiveShelfIdx >= 0
      ? exclusiveShelfIdx
      : colIdx((h) => h === "bookshelves" || h.includes("shelf"));

    if (titleIdx === -1) {
      setMessage("CSV must have a 'title' column");
      setCsvLoading(false);
      return;
    }

    const candidates = lines.slice(1).map((line) => {
      const vals = parseCsvLine(line);
      const title = vals[titleIdx] ?? "";
      const author = authorIdx >= 0 ? vals[authorIdx] : undefined;
      const isbn = isbnIdx >= 0 ? cleanIsbnCell(vals[isbnIdx]) : undefined;
      const readAt = dateReadIdx >= 0 ? parseGoodreadsDate(vals[dateReadIdx]) : null;
      const shelfRaw = bookshelvesIdx >= 0 ? vals[bookshelvesIdx]?.toLowerCase() : "";
      const hint = inferStateFromShelf(shelfRaw, readAt);

      return { title, author: author || undefined, isbn: isbn || undefined, hint };
    }).filter((c) => c.title.length > 0);

    const results = await matchNebulaBooks(candidates.slice(0, 50)); // limit to 50 for performance
    setCsvMatches(results);
    setCsvLoading(false);
  }, []);

  if (!showUploadPanel) return null;

  return (
    <div className="absolute left-4 top-4 bottom-18 w-80 z-20 pointer-events-auto">
      <div className="backdrop-blur-md bg-surface-solid/85 rounded-xl border border-border/50 p-4 space-y-3 max-h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Add to Shelf</h2>
          <button onClick={() => setShowUploadPanel(false)} className="text-muted hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => { setMode("search"); setCsvMatches(null); }}
            className={`px-2.5 py-1 text-[10px] rounded-full transition-all ${
              mode === "search" ? "bg-foreground/15 text-foreground border border-foreground/20" : "bg-surface-solid/40 text-muted border border-border/30"
            }`}
          >
            <Search size={10} className="inline mr-1" />Search
          </button>
          <button
            onClick={() => { setMode("scan"); setQuery(""); setCsvMatches(null); }}
            className={`px-2.5 py-1 text-[10px] rounded-full transition-all ${
              mode === "scan" ? "bg-foreground/15 text-foreground border border-foreground/20" : "bg-surface-solid/40 text-muted border border-border/30"
            }`}
          >
            <Camera size={10} className="inline mr-1" />Scan
          </button>
          <button
            onClick={() => { setMode("barcode"); setQuery(""); setCsvMatches(null); }}
            className={`px-2.5 py-1 text-[10px] rounded-full transition-all ${
              mode === "barcode" ? "bg-foreground/15 text-foreground border border-foreground/20" : "bg-surface-solid/40 text-muted border border-border/30"
            }`}
          >
            <ScanLine size={10} className="inline mr-1" />Barcode
          </button>
          <button
            onClick={() => { setMode("csv"); setQuery(""); }}
            className={`px-2.5 py-1 text-[10px] rounded-full transition-all ${
              mode === "csv" ? "bg-foreground/15 text-foreground border border-foreground/20" : "bg-surface-solid/40 text-muted border border-border/30"
            }`}
          >
            <Upload size={10} className="inline mr-1" />CSV
          </button>
        </div>

        {/* Search mode */}
        {mode === "search" && (
          <div className="space-y-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or author..."
              className="w-full rounded-lg border border-border/30 bg-surface-solid/40 px-3 py-1.5 text-xs text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
            {searchResults.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {searchResults.map((book) => {
                  const onShelf = isOnShelf(book.id);
                  return (
                    <div key={book.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-foreground/3 border border-border/10">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground truncate">{book.title}</p>
                        <p className="text-[10px] text-muted truncate">{book.author_name}</p>
                      </div>
                      {onShelf ? (
                        <span className="text-[10px] text-emerald-400 shrink-0"><Check size={12} /></span>
                      ) : (
                        <AddBookMenu bookId={book.id} align="end" onAdded={() => handleAdded(book.id)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CSV mode */}
        {mode === "csv" && !csvMatches && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted">Upload a CSV with a &quot;title&quot; column (optionally &quot;author&quot; and &quot;isbn&quot;)</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="w-full text-xs text-muted file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-[10px] file:bg-accent/20 file:text-accent"
            />
            {csvLoading && <p className="text-[10px] text-muted animate-pulse">Matching books...</p>}
          </div>
        )}

        {/* CSV review */}
        {mode === "csv" && csvMatches && (
          <NebulaCsvReview
            matches={csvMatches}
            onDone={() => { setCsvMatches(null); if (fileRef.current) fileRef.current.value = ""; }}
          />
        )}

        {/* Scan mode */}
        {mode === "scan" && (
          <NebulaSpineScan onDone={() => { /* keep panel open after scan */ }} />
        )}

        {/* Barcode mode */}
        {mode === "barcode" && <NebulaBarcodeScan />}

        {/* Message */}
        {message && <p className="text-[10px] text-emerald-400">{message}</p>}
      </div>
    </div>
  );
}

// --- CSV helpers ---

/** Parse one CSV line, honouring quoted fields with embedded commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Goodreads ISBN cells are wrapped like ="0316134678". Strip the wrapping. */
function cleanIsbnCell(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/^="?/, "").replace(/"?$/, "").replace(/[^0-9X]/gi, "");
}

/** Goodreads dates use yyyy/mm/dd. Convert to ISO yyyy-mm-dd, or return null. */
function parseGoodreadsDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // Already ISO?
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  // Goodreads slash format
  const slashMatch = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Map a Goodreads "Exclusive Shelf" or shelf list to our state hint. */
function inferStateFromShelf(shelfRaw: string | undefined, readAt: string | null): MatchHint | undefined {
  if (!shelfRaw) {
    return readAt ? { ownership: "owned", status: "read", readAt } : undefined;
  }
  const s = shelfRaw.toLowerCase();
  if (s.includes("currently-reading") || s.includes("currently reading")) {
    return { ownership: "owned", status: "reading" };
  }
  if (s.includes("to-read") || s.includes("to read")) {
    // Conservative default — Goodreads "to-read" doesn't tell us if owned or wished
    return { ownership: "owned", status: "unread" };
  }
  if (s.includes("read")) {
    return { ownership: "owned", status: "read", readAt };
  }
  // Custom shelf (e.g. "favorites", "sci-fi"): no inference, fall back to bulk
  return undefined;
}
