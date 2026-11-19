"use server";

import { lookupISBN, fuzzyMatch, type OLSearchResult } from "@/lib/open-library";

export interface CsvRow {
  title: string;
  author: string;
  isbn: string | null;
  rating: number | null;
  shelf: string | null;
}

export interface MatchedCsvBook {
  row: CsvRow;
  match: OLSearchResult | null;
  status: string;
  selected: boolean;
}

/**
 * Map Goodreads shelf names to our edge types.
 */
function mapShelf(shelf: string | null): string {
  if (!shelf) return "owns";
  const s = shelf.toLowerCase().trim();
  if (s === "read") return "read";
  if (s === "currently-reading") return "reading";
  if (s === "to-read") return "wishlist";
  return "owns";
}

/**
 * Match CSV rows against Open Library. ISBN lookup first, then fuzzy match.
 * Processes in batches of 5 for speed.
 */
export async function matchCsvRows(
  rows: CsvRow[]
): Promise<{ matched: MatchedCsvBook[] }> {
  const matched: MatchedCsvBook[] = [];

  for (let i = 0; i < rows.length; i += 5) {
    const batch = rows.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (row): Promise<MatchedCsvBook> => {
        let match: OLSearchResult | null = null;

        // Try ISBN first (fastest, most accurate)
        if (row.isbn) {
          const detail = await lookupISBN(row.isbn);
          if (detail) {
            match = {
              title: detail.title,
              author: detail.author,
              isbn: detail.isbn,
              coverUrl: detail.coverUrl,
              publishedYear: detail.publishedYear,
              publisher: detail.publisher,
              pageCount: detail.pageCount,
              subjects: detail.subjects,
              olKey: detail.olKey,
            };
          }
        }

        // Fall back to fuzzy match
        if (!match && row.title) {
          match = await fuzzyMatch(row.title, row.author);
        }

        return {
          row,
          match,
          status: mapShelf(row.shelf),
          selected: match !== null,
        };
      })
    );
    matched.push(...results);
  }

  return { matched };
}
