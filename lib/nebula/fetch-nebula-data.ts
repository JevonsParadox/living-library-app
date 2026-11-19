import { createAuthClient } from "@/lib/supabase-server";
import { paginatedSelect } from "./supabase-paginate";
import { normalizeOwnership, normalizeStatus, type NbRegion, type UserBookState } from "./nebula-types";

export interface NbBookWithCoords {
  id: string;
  title: string;
  canonical_genre: string | null;
  popularity_score: number;
  engagement_score: number;
  cover_image_url: string | null;
  publication_year: number | null;
  page_count: number | null;
  author_name: string | null;
  series_id: string | null;
  series_order: number | null;
  x: number;
  y: number;
  z: number;
  region_id: string | null;
}

export async function fetchNebulaData(): Promise<{
  books: NbBookWithCoords[];
  regions: NbRegion[];
  seriesNames: Record<string, string>;
  userLibrary: UserBookState[];
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return { books: [], regions: [], seriesNames: {}, userLibrary: [] };

  const supabase = await createAuthClient();

  // PostgREST caps un-paginated `.select()` at 1000 rows. We have 12k+ books;
  // every fetch below uses paginatedSelect so the full catalog reaches the
  // browser. nb_regions doesn't need pagination (only ~14 rows).
  type BookRow = {
    id: string;
    title: string;
    canonical_genre: string | null;
    popularity_score: number;
    engagement_score: number | null;
    cover_image_url: string | null;
    publication_year: number | null;
    page_count: number | null;
    primary_author_id: string | null;
    series_id: string | null;
    series_order: number | null;
  };
  type CoordRow = { book_id: string; x: number; y: number; z: number; region_id: string | null };
  type AuthorRow = { id: string; name: string };
  type SeriesRow = { id: string; name: string };
  type ShelfRow = {
    book_id: string;
    ownership_type: string | null;
    read_status: string | null;
    started_at: string | null;
    finished_at: string | null;
    read_at: string | null;
    created_at: string | null;
  };

  const [{ data: regions }, books, coords, authors, seriesData, shelfData] =
    await Promise.all([
      supabase
        .from("nb_regions")
        .select("id, name, slug, description, anchor_x, anchor_y, anchor_z, color_hex, icon_name, sort_order")
        .order("sort_order"),
      paginatedSelect<BookRow>((from, to) =>
        supabase
          .from("nb_books")
          .select("id, title, canonical_genre, popularity_score, engagement_score, cover_image_url, publication_year, page_count, primary_author_id, series_id, series_order")
          .range(from, to),
      ),
      paginatedSelect<CoordRow>((from, to) =>
        supabase
          .from("nb_book_coordinates")
          .select("book_id, x, y, z, region_id")
          .range(from, to),
      ),
      paginatedSelect<AuthorRow>((from, to) =>
        supabase.from("nb_authors").select("id, name").range(from, to),
      ),
      paginatedSelect<SeriesRow>((from, to) =>
        supabase.from("nb_series").select("id, name").range(from, to),
      ),
      paginatedSelect<ShelfRow>((from, to) =>
        supabase
          .from("nb_user_books")
          .select("book_id, ownership_type, read_status, started_at, finished_at, read_at, created_at")
          .range(from, to),
      ),
    ]);

  // Build lookups
  const seriesNameMap: Record<string, string> = {};
  for (const s of seriesData) { seriesNameMap[s.id] = s.name; }

  const coordMap = new Map(
    coords.map((c) => [c.book_id, { x: Number(c.x), y: Number(c.y), z: Number(c.z), region_id: c.region_id }])
  );
  const authorMap = new Map(authors.map((a) => [a.id, a.name]));

  // Merge books with coordinates and author names
  const mergedBooks: NbBookWithCoords[] = [];
  for (const book of books) {
    const coord = coordMap.get(book.id);
    if (!coord) continue; // skip books without coordinates
    mergedBooks.push({
      id: book.id,
      title: book.title,
      canonical_genre: book.canonical_genre,
      popularity_score: Number(book.popularity_score),
      engagement_score: Number(book.engagement_score ?? 0),
      cover_image_url: book.cover_image_url,
      publication_year: book.publication_year,
      page_count: book.page_count,
      author_name: book.primary_author_id ? (authorMap.get(book.primary_author_id) ?? null) : null,
      series_id: book.series_id ?? null,
      series_order: book.series_order ? Number(book.series_order) : null,
      x: coord.x,
      y: coord.y,
      z: coord.z,
      region_id: coord.region_id,
    });
  }

  const userLibrary: UserBookState[] = shelfData.map((row) => {
    const ownership = normalizeOwnership(row.ownership_type);
    const rawStatus = normalizeStatus(row.read_status);
    const readAt = row.read_at;
    // Legacy coercion: rows seeded before the state model defaulted to
    // 'unknown' (→ 'unread'). If they have a read_at date, treat as read.
    const status = rawStatus === "unread" && readAt && ownership === "owned" ? "read" : rawStatus;
    return {
      bookId: row.book_id,
      ownership,
      status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      readAt,
      addedAt: row.created_at,
    };
  });

  return {
    books: mergedBooks,
    regions: (regions ?? []) as NbRegion[],
    seriesNames: seriesNameMap,
    userLibrary,
  };
}
