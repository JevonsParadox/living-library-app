/**
 * Project Nebula — TypeScript interfaces for the nb_ schema.
 * Completely isolated from Universe types.
 */

export interface NbAuthor {
  id: string;
  name: string;
  sort_name: string | null;
  bio: string | null;
  nationality: string | null;
  birth_year: number | null;
  death_year: number | null;
}

export interface NbSeries {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  popularity_score: number | null;
}

export interface NbBook {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string | null;
  description: string | null;
  short_description: string | null;
  publication_year: number | null;
  original_publication_year: number | null;
  page_count: number | null;
  language_code: string;
  isbn_10: string | null;
  isbn_13: string | null;
  asin: string | null;
  cover_image_url: string | null;
  canonical_genre: string | null;
  age_audience: string | null;
  popularity_score: number;
  quality_score: number;
  series_id: string | null;
  series_order: number | null;
  primary_author_id: string | null;
}

export interface NbRegion {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
  color_hex: string | null;
  icon_name: string | null;
  sort_order: number;
}

export interface NbCluster {
  id: string;
  parent_cluster_id: string | null;
  region_id: string | null;
  level: string;
  name: string;
  description: string | null;
  centroid_x: number | null;
  centroid_y: number | null;
  centroid_z: number | null;
  radius: number | null;
  density_score: number | null;
}

export interface NbBookCoordinate {
  book_id: string;
  layout_version: string;
  region_id: string | null;
  primary_cluster_id: string | null;
  x: number;
  y: number;
  z: number;
  local_radius: number | null;
  stability_score: number | null;
}

export interface NbBookEdge {
  id: string;
  source_book_id: string;
  target_book_id: string;
  edge_type: string;
  score: number;
  rank: number | null;
  explanation: Record<string, unknown> | null;
}

export interface NbUserBook {
  id: string;
  user_id: string;
  book_id: string;
  ownership_type: string;
  read_status: string;
  rating: number | null;
  started_at: string | null;
  finished_at: string | null;
  read_at: string | null;
  days_to_read: number | null;
  chronology_confidence: number;
  added_at: string;
}

export interface NbBookTag {
  id: string;
  book_id: string;
  tag_type: string;
  tag_value: string;
  source: string;
  weight: number;
}

// --- User library state vocabulary ---

export type BookOwnership = "owned" | "wishlist";
export type BookStatus = "unread" | "reading" | "read" | "next_up";

export const BOOK_OWNERSHIP_VALUES: BookOwnership[] = ["owned", "wishlist"];
export const BOOK_STATUS_VALUES: BookStatus[] = ["unread", "reading", "read", "next_up"];

/** Client-side shape per book in the user's library. Read from nb_user_books. */
export interface UserBookState {
  bookId: string;
  ownership: BookOwnership;
  status: BookStatus;
  startedAt: string | null;
  finishedAt: string | null;
  readAt: string | null;
  /** Row creation timestamp (nb_user_books.created_at). Drives D6
   *  reading-trail comet — the trail shows the most-recent N additions. */
  addedAt: string | null;
}

/** Five user-facing labels driven by the (ownership, status) pair. */
export type LibraryLabel = "Read" | "Reading" | "Up Next" | "On shelf" | "Wishlist";

export function labelForBookState(state: UserBookState | undefined): LibraryLabel | null {
  if (!state) return null;
  if (state.ownership === "wishlist") return "Wishlist";
  switch (state.status) {
    case "read": return "Read";
    case "reading": return "Reading";
    case "next_up": return "Up Next";
    case "unread": return "On shelf";
  }
}

/** Coerce loose schema strings into known enum values. Falls back to safe defaults. */
export function normalizeOwnership(raw: string | null | undefined): BookOwnership {
  return raw === "wishlist" ? "wishlist" : "owned";
}

export function normalizeStatus(raw: string | null | undefined): BookStatus {
  if (raw === "reading" || raw === "read" || raw === "next_up") return raw;
  return "unread"; // covers 'unknown', null, anything else
}
