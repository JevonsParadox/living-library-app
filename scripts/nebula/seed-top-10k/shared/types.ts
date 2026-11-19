/**
 * Shared types for the Phase C seed pipeline.
 */

export type CanonicalGenre = "sci-fi" | "fantasy" | "horror" | "unknown";

export interface IsfdbCandidate {
  title_id: number;
  title: string;
  title_synopsis: string | null;
  publication_year: number | null;
  title_ttype: string;
  canonical_author_id: number | null;
  canonical_author_name: string | null;
  series_id: number | null;
  series_title: string | null;
  series_order: number | null;
  canonical_pub_id: number | null;
  isbn_13: string | null;
  isbn_10: string | null;
  page_count: number | null;
  publisher: string | null;
  cover_path: string | null;
  tags: string[];
  awards: Award[];
  edition_count: number;
  translated: boolean;
}

export interface Award {
  name: string;
  category: string | null;
  year: number | null;
  result: "won" | "nominee";
}

export interface ScoredCandidate extends IsfdbCandidate {
  goodreads_ratings_count: number | null;
  canonical_genre: CanonicalGenre;
  sub_genre: string | null;
  canon: boolean;
  series_is_anchor: boolean;
  seed_score: number;
  signals: {
    awards: number;
    editions: number;
    goodreads: number;
    series_anchor: number;
    recency: number;
    canon: number;
  };
}
