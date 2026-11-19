"use server";

import { auth } from "@clerk/nextjs/server";
import { createAuthClient, createServiceClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

export interface NbBookDetail {
  id: string;
  title: string;
  description: string | null;
  /** LLM-paraphrased short summary. Prefer this for display to avoid copyright risk. */
  short_description: string | null;
  publication_year: number | null;
  page_count: number | null;
  cover_image_url: string | null;
  canonical_genre: string | null;
  popularity_score: number;
  author_name: string | null;
  series_name: string | null;
  series_order: number | null;
  /** Raw external_ids (incl. provenance); used by the attribution footer. */
  external_ids: Record<string, unknown> | null;
}

export async function getNebulaBookDetail(bookId: string): Promise<NbBookDetail | null> {
  // Read-only catalog data — public to all authenticated users via RLS, but we
  // use the service client so a transient Clerk JWT exchange failure doesn't
  // break the detail panel. No user-scoped data is exposed by this query.
  const supabase = createServiceClient();

  const { data: book } = await supabase
    .from("nb_books")
    .select("id, title, description, short_description, publication_year, page_count, cover_image_url, canonical_genre, popularity_score, primary_author_id, series_id, series_order, external_ids")
    .eq("id", bookId)
    .single();

  if (!book) return null;

  // Fetch author name
  let author_name: string | null = null;
  if (book.primary_author_id) {
    const { data: author } = await supabase
      .from("nb_authors")
      .select("name")
      .eq("id", book.primary_author_id)
      .single();
    author_name = author?.name ?? null;
  }

  // Fetch series name
  let series_name: string | null = null;
  if (book.series_id) {
    const { data: series } = await supabase
      .from("nb_series")
      .select("name")
      .eq("id", book.series_id)
      .single();
    series_name = series?.name ?? null;
  }

  return {
    id: book.id,
    title: book.title,
    description: book.description,
    short_description: book.short_description,
    publication_year: book.publication_year,
    page_count: book.page_count,
    cover_image_url: book.cover_image_url,
    canonical_genre: book.canonical_genre,
    popularity_score: Number(book.popularity_score),
    author_name,
    series_name,
    series_order: book.series_order ? Number(book.series_order) : null,
    external_ids: (book.external_ids as Record<string, unknown> | null) ?? null,
  };
}

// --- Canonical matching engine ---

/** State hint inferred at parse time (e.g. from Goodreads CSV columns). */
export interface MatchHint {
  ownership?: "owned" | "wishlist";
  status?: "unread" | "reading" | "read" | "next_up";
  readAt?: string | null;
}

export interface MatchCandidate {
  title: string;
  author?: string;
  isbn?: string;
  /** Optional state hint derived from the source (CSV columns, etc.). Echoed back in MatchResult. */
  hint?: MatchHint;
}

export interface MatchResult {
  extractedTitle: string;
  extractedAuthor: string | undefined;
  matchedBookId: string | null;
  matchedTitle: string | null;
  matchedAuthor: string | null;
  matchedCover: string | null;
  confidence: number;
  /** Echoed from input candidate so the review UI can show inferred state per row. */
  hint?: MatchHint;
}

function computeSimilarity(a: string, b: string): number {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1;
  if (al.includes(bl) || bl.includes(al)) return 0.8;
  // Word overlap
  const aWords = new Set(al.split(/\s+/));
  const bWords = new Set(bl.split(/\s+/));
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap++;
  const total = Math.max(aWords.size, bWords.size);
  return total > 0 ? overlap / total : 0;
}

export async function matchNebulaBooks(
  candidates: MatchCandidate[]
): Promise<MatchResult[]> {
  const supabase = await createAuthClient();
  const results: MatchResult[] = [];

  for (const candidate of candidates) {
    let bestMatch: { id: string; title: string; cover_image_url: string | null; author_name: string | null } | null = null;
    let bestConfidence = 0;

    // 1. Exact ISBN match
    if (candidate.isbn) {
      const cleanIsbn = candidate.isbn.replace(/[^0-9X]/gi, "");
      const { data } = await supabase
        .from("nb_books")
        .select("id, title, cover_image_url, primary_author_id")
        .or(`isbn_13.eq.${cleanIsbn},isbn_10.eq.${cleanIsbn}`)
        .limit(1);

      if (data && data.length > 0) {
        let authorName: string | null = null;
        if (data[0].primary_author_id) {
          const { data: a } = await supabase.from("nb_authors").select("name").eq("id", data[0].primary_author_id).single();
          authorName = a?.name ?? null;
        }
        bestMatch = { id: data[0].id, title: data[0].title, cover_image_url: data[0].cover_image_url, author_name: authorName };
        bestConfidence = 0.95; // ISBN match is very high confidence
      }
    }

    // 2. Fuzzy title match (if no ISBN match or low confidence)
    if (bestConfidence < 0.8 && candidate.title) {
      const searchTerm = candidate.title.split(/[:(]/)[0].trim(); // strip subtitle/series suffix
      const { data } = await supabase
        .from("nb_books")
        .select("id, title, cover_image_url, primary_author_id")
        .ilike("title", `%${searchTerm}%`)
        .limit(10);

      if (data) {
        for (const book of data) {
          const titleScore = computeSimilarity(candidate.title, book.title);
          let authorScore = 0;
          let authorName: string | null = null;

          if (book.primary_author_id) {
            const { data: a } = await supabase.from("nb_authors").select("name").eq("id", book.primary_author_id).single();
            authorName = a?.name ?? null;
            if (candidate.author && authorName) {
              authorScore = computeSimilarity(candidate.author, authorName);
            }
          }

          const confidence = 0.35 * titleScore + 0.25 * authorScore + (candidate.isbn ? 0 : 0.25) + 0.10 * (titleScore > 0.9 ? 1 : 0);

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = { id: book.id, title: book.title, cover_image_url: book.cover_image_url, author_name: authorName };
          }
        }
      }
    }

    results.push({
      extractedTitle: candidate.title,
      extractedAuthor: candidate.author,
      matchedBookId: bestMatch?.id ?? null,
      matchedTitle: bestMatch?.title ?? null,
      matchedAuthor: bestMatch?.author_name ?? null,
      matchedCover: bestMatch?.cover_image_url ?? null,
      confidence: Math.round(bestConfidence * 100) / 100,
      hint: candidate.hint,
    });
  }

  return results;
}

// --- Semantic neighbours (Block C) ---

/**
 * Top-k semantic-similarity neighbours for a book, read from
 * nb_book_edges (populated by scripts/nebula/build-similarity-edges.ts).
 * Returns ordered book IDs, closest first. Empty if edges aren't built yet.
 */
export async function getSemanticNeighbors(bookId: string, k = 3): Promise<string[]> {
  const supabase = await createAuthClient();
  const { data, error } = await supabase
    .from("nb_book_edges")
    .select("target_book_id, rank")
    .eq("source_book_id", bookId)
    .eq("edge_type", "semantic_similarity")
    .order("rank", { ascending: true })
    .limit(k);
  if (error || !data) return [];
  return data.map((r) => r.target_book_id as string);
}

/**
 * Batched semantic-neighbour fetch — one query for many source books at once.
 * Returns a map of source bookId → ordered neighbour ids. Source ids without
 * any edges in the table are simply absent from the map (caller falls back
 * to a spatial KNN). Used by the illumination pipeline so first-load with a
 * 50-book shelf doesn't fire 50 sequential round-trips.
 *
 * Caps at k * sourceIds.length rows — for k=6, source=100 that's 600 rows,
 * trivial. Larger shelves should still be one trip.
 */
export async function getSemanticNeighborsBatch(
  bookIds: string[],
  k = 6,
): Promise<Record<string, string[]>> {
  if (bookIds.length === 0) return {};
  const supabase = await createAuthClient();
  const { data, error } = await supabase
    .from("nb_book_edges")
    .select("source_book_id, target_book_id, rank")
    .in("source_book_id", bookIds)
    .eq("edge_type", "semantic_similarity")
    .order("source_book_id", { ascending: true })
    .order("rank", { ascending: true });
  if (error || !data) return {};
  const out: Record<string, string[]> = {};
  for (const row of data as Array<{ source_book_id: string; target_book_id: string; rank: number }>) {
    const list = out[row.source_book_id] ?? (out[row.source_book_id] = []);
    if (list.length < k) list.push(row.target_book_id);
  }
  return out;
}

// --- Bridge books (Block C, Commit 3) ---

export interface BridgeBook {
  bookId: string;
  title: string;
  authorName: string | null;
  coverUrl: string | null;
  bridgeScore: number;
}

/** Diagnostic shape — lets the UI render a placeholder when no bridges are found. */
export interface BridgeResult {
  status: "ok" | "no_owned" | "single_region" | "no_candidates";
  fromRegion: string | null;
  toRegion: string | null;
  bridges: BridgeBook[];
}

/**
 * Find books that bridge two of the user's most-populated owned regions.
 * Backed by the nb_bridge_candidates RPC (region-pair specific).
 */
export async function getBridgeBooksForLibrary(): Promise<BridgeResult> {
  const empty: BridgeResult = { status: "no_owned", fromRegion: null, toRegion: null, bridges: [] };
  const { userId } = await auth();
  if (!userId) return empty;
  const supabase = await createAuthClient();

  // 1. Owned books
  const { data: userBooks } = await supabase
    .from("nb_user_books")
    .select("book_id, ownership_type")
    .eq("user_id", userId)
    .eq("ownership_type", "owned");
  if (!userBooks || userBooks.length < 3) return empty;

  const ownedIds = userBooks.map((u) => u.book_id as string);

  // 2. Region counts among owned books → top 2 regions. Page in groups of 200
  // to avoid URL-length issues on huge shelves (the previous .slice(0, 200)
  // silently dropped any owned books beyond that count).
  const ownedCoords: Array<{ book_id: string; region_id: string | null }> = [];
  const BRIDGE_PAGE = 200;
  for (let i = 0; i < ownedIds.length; i += BRIDGE_PAGE) {
    const chunk = ownedIds.slice(i, i + BRIDGE_PAGE);
    const { data } = await supabase
      .from("nb_book_coordinates")
      .select("book_id, region_id")
      .in("book_id", chunk);
    if (data) ownedCoords.push(...(data as Array<{ book_id: string; region_id: string | null }>));
  }
  const regionCount = new Map<string, number>();
  for (const c of ownedCoords ?? []) {
    if (c.region_id) regionCount.set(c.region_id as string, (regionCount.get(c.region_id as string) ?? 0) + 1);
  }
  const topRegions = Array.from(regionCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (topRegions.length < 2) {
    return { status: "single_region", fromRegion: null, toRegion: null, bridges: [] };
  }
  const [regionA, regionB] = topRegions.map(([id]) => id);

  // Region names for the header
  const { data: regions } = await supabase
    .from("nb_regions").select("id, name").in("id", [regionA, regionB]);
  const regionNameMap = new Map((regions ?? []).map((r) => [r.id as string, r.name as string]));
  const fromRegion = regionNameMap.get(regionA) ?? null;
  const toRegion = regionNameMap.get(regionB) ?? null;

  // 3. RPC: find books bridging both regions, ranked by bridge_score
  const { data: rpcRows, error: rpcErr } = await supabase.rpc("nb_bridge_candidates", {
    p_region_a: regionA,
    p_region_b: regionB,
    p_owned_ids: ownedIds,
    p_limit: 5,
  });
  if (rpcErr) {
    console.error("[getBridgeBooksForLibrary] RPC error:", rpcErr.message);
    return { status: "no_candidates", fromRegion, toRegion, bridges: [] };
  }
  const bridgers = (rpcRows ?? []) as Array<{ book_id: string; bridge_score: number }>;
  if (bridgers.length === 0) {
    return { status: "no_candidates", fromRegion, toRegion, bridges: [] };
  }

  // 4. Hydrate book details
  const bridgerIds = bridgers.map((b) => b.book_id);
  const scoreMap = new Map(bridgers.map((b) => [b.book_id, Number(b.bridge_score)]));
  const { data: books } = await supabase
    .from("nb_books")
    .select("id, title, cover_image_url, primary_author_id")
    .in("id", bridgerIds);

  const authorIds = (books ?? []).map((b) => b.primary_author_id).filter(Boolean) as string[];
  const { data: authors } = authorIds.length
    ? await supabase.from("nb_authors").select("id, name").in("id", authorIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const authorNameMap = new Map((authors ?? []).map((a) => [a.id as string, a.name as string]));

  // Preserve RPC ranking order
  const orderedBooks = bridgerIds
    .map((id) => (books ?? []).find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  return {
    status: "ok",
    fromRegion,
    toRegion,
    bridges: orderedBooks.map((b) => ({
      bookId: b.id as string,
      title: b.title as string,
      authorName: b.primary_author_id ? authorNameMap.get(b.primary_author_id as string) ?? null : null,
      coverUrl: (b.cover_image_url as string | null) ?? null,
      bridgeScore: scoreMap.get(b.id as string) ?? 0,
    })),
  };
}

// --- ISBN lookup against the Nebula corpus ---

export interface NebulaIsbnLookupResult {
  bookId: string;
  title: string;
  authorName: string | null;
  coverUrl: string | null;
  isbn13: string | null;
  isbn10: string | null;
}

/**
 * Look up a book in the Nebula corpus by ISBN-10 or ISBN-13.
 * Returns null if no match — books outside our 4,497-book corpus
 * aren't auto-added (that's a separate Open Library fallback feature).
 */
export async function lookupNebulaBookByIsbn(
  isbn: string
): Promise<{ book?: NebulaIsbnLookupResult; error?: string }> {
  const cleaned = isbn.replace(/[^0-9X]/gi, "");
  if (cleaned.length !== 10 && cleaned.length !== 13) {
    return { error: "Invalid ISBN length" };
  }

  const supabase = await createAuthClient();
  const { data, error } = await supabase
    .from("nb_books")
    .select("id, title, cover_image_url, primary_author_id, isbn_10, isbn_13")
    .or(`isbn_13.eq.${cleaned},isbn_10.eq.${cleaned}`)
    .limit(1);

  if (error) return { error: error.message };
  if (!data || data.length === 0) return {};

  const row = data[0];
  let authorName: string | null = null;
  if (row.primary_author_id) {
    const { data: a } = await supabase.from("nb_authors").select("name").eq("id", row.primary_author_id).single();
    authorName = a?.name ?? null;
  }

  return {
    book: {
      bookId: row.id as string,
      title: row.title as string,
      authorName,
      coverUrl: (row.cover_image_url as string | null) ?? null,
      isbn13: (row.isbn_13 as string | null) ?? null,
      isbn10: (row.isbn_10 as string | null) ?? null,
    },
  };
}

// --- Shelf CRUD ---

export interface AddToShelfOptions {
  ownership?: "owned" | "wishlist";
  status?: "unread" | "reading" | "read" | "next_up";
  rating?: number;
  started_at?: string | null;
  finished_at?: string | null;
  read_at?: string | null;
}

export async function addToNebulaShelf(
  bookId: string,
  opts?: AddToShelfOptions
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };

  const supabase = await createAuthClient();

  const { error } = await supabase.from("nb_user_books").upsert(
    {
      user_id: userId,
      book_id: bookId,
      ownership_type: opts?.ownership ?? "owned",
      read_status: opts?.status ?? "unread",
      rating: opts?.rating ?? null,
      started_at: opts?.started_at ?? null,
      finished_at: opts?.finished_at ?? null,
      read_at: opts?.read_at ?? null,
    },
    { onConflict: "user_id,book_id" }
  );

  if (error) return { error: error.message };

  // Popularity signal: upload (strong signal — this is a user committing a
  // book to their library). Wishlist-type adds emit a lighter signal.
  const signalType: PopularitySignalType = opts?.ownership === "wishlist" ? "wishlist" : "upload";
  await supabase.from("nb_popularity_signals").insert({
    work_id: bookId,
    signal_type: signalType,
    user_id: userId,
    weight: signalType === "upload" ? 5 : 3,
  });

  revalidatePath("/nebula");
  return { success: true };
}

/**
 * Update one or more state fields for an existing library row.
 * Only writes the keys you pass — leaves others untouched.
 */
export async function updateNebulaBookState(
  bookId: string,
  partial: Partial<AddToShelfOptions>
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };

  const supabase = await createAuthClient();

  const update: Record<string, unknown> = {};
  if (partial.ownership !== undefined) update.ownership_type = partial.ownership;
  if (partial.status !== undefined) update.read_status = partial.status;
  if (partial.rating !== undefined) update.rating = partial.rating;
  if (partial.started_at !== undefined) update.started_at = partial.started_at;
  if (partial.finished_at !== undefined) update.finished_at = partial.finished_at;
  if (partial.read_at !== undefined) update.read_at = partial.read_at;

  if (Object.keys(update).length === 0) return { success: true };

  const { error } = await supabase
    .from("nb_user_books")
    .update(update)
    .eq("user_id", userId)
    .eq("book_id", bookId);

  if (error) return { error: error.message };

  // Emit a signal reflecting the new state transition.
  let signalType: PopularitySignalType | null = null;
  if (partial.status === "read") signalType = "read";
  else if (partial.ownership === "wishlist") signalType = "wishlist";
  if (signalType) {
    await supabase.from("nb_popularity_signals").insert({
      work_id: bookId,
      signal_type: signalType,
      user_id: userId,
      weight: 3,
    });
  }

  revalidatePath("/nebula");
  return { success: true };
}

export async function removeFromNebulaShelf(
  bookId: string
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };

  const supabase = await createAuthClient();

  const { error } = await supabase
    .from("nb_user_books")
    .delete()
    .eq("user_id", userId)
    .eq("book_id", bookId);

  if (error) return { error: error.message };
  revalidatePath("/nebula");
  return { success: true };
}

/**
 * Set or clear the read_at date for a book on the user's shelf.
 * Used by PathBooksTray to let users add a date inline.
 */
export async function setNebulaBookDate(
  bookId: string,
  readAt: string | null
): Promise<{ success?: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };

  // Basic validation: accept ISO date "YYYY-MM-DD" or null
  if (readAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(readAt)) {
    return { error: "Invalid date format (expected YYYY-MM-DD)" };
  }

  const supabase = await createAuthClient();

  const { error } = await supabase
    .from("nb_user_books")
    .update({ read_at: readAt })
    .eq("user_id", userId)
    .eq("book_id", bookId);

  if (error) return { error: error.message };
  revalidatePath("/nebula");
  return { success: true };
}

export async function getNebulaShelf(): Promise<string[]> {
  const { userId } = await auth();
  if (!userId) return [];

  const supabase = await createAuthClient();

  const { data } = await supabase
    .from("nb_user_books")
    .select("book_id")
    .eq("user_id", userId);

  return (data ?? []).map((d) => d.book_id);
}

// --- Path computation ---

const WORLD_SCALE = 2.5;

export interface PathNode {
  bookId: string;
  title: string;
  x: number;
  y: number;
  z: number;
  readAt: string | null;
  daysGapToNext: number | null;
}

export async function computeNebulaPath(): Promise<PathNode[]> {
  const { userId } = await auth();
  if (!userId) return [];

  const supabase = await createAuthClient();

  // Fetch user books — the path is your reading history, so we only include
  // books with status='read'. We also pull rows with a read_at date but
  // 'unknown' status, to cover legacy data seeded before the state model.
  const { data: userBooks } = await supabase
    .from("nb_user_books")
    .select("book_id, read_at, started_at, finished_at, read_status, ownership_type")
    .eq("user_id", userId);

  if (!userBooks || userBooks.length === 0) return [];

  // Filter: read books or legacy (owned + has read_at + status not yet set)
  const readBooks = userBooks.filter((ub) => {
    if (ub.ownership_type === "wishlist") return false;
    if (ub.read_status === "read") return true;
    // Legacy: 'unknown' or null status with a read date counts as read
    return ub.read_at !== null && (ub.read_status === "unknown" || !ub.read_status);
  });

  if (readBooks.length === 0) return [];

  const bookIds = readBooks.map((ub) => ub.book_id);

  // Fetch coordinates and titles. PostgREST allows large `.in()` lists but
  // we cap at 200 ids per call as defence-in-depth (URL length on huge
  // shelves) and stitch the pages together. Previously this was a single
  // call with a `.slice(0, 200)`, silently truncating users with > 200
  // read books.
  type CoordRow = { book_id: string; x: number; y: number; z: number };
  type BookRow = { id: string; title: string };
  const coords: CoordRow[] = [];
  const books: BookRow[] = [];
  const PAGE = 200;
  for (let i = 0; i < bookIds.length; i += PAGE) {
    const chunk = bookIds.slice(i, i + PAGE);
    const [{ data: coordChunk }, { data: bookChunk }] = await Promise.all([
      supabase.from("nb_book_coordinates").select("book_id, x, y, z").in("book_id", chunk),
      supabase.from("nb_books").select("id, title").in("id", chunk),
    ]);
    if (coordChunk) coords.push(...(coordChunk as CoordRow[]));
    if (bookChunk) books.push(...(bookChunk as BookRow[]));
  }

  const coordMap = new Map((coords ?? []).map((c) => [c.book_id, { x: Number(c.x), y: Number(c.y), z: Number(c.z) }]));
  const titleMap = new Map((books ?? []).map((b) => [b.id, b.title]));
  const dateMap = new Map(readBooks.map((ub) => [ub.book_id, ub.read_at ?? ub.finished_at ?? ub.started_at]));

  // Check if any dates exist
  const hasChronology = readBooks.some((ub) => ub.read_at || ub.finished_at || ub.started_at);

  let orderedIds: string[];

  if (hasChronology) {
    // Chronology mode: sort by date
    orderedIds = [...bookIds]
      .filter((id) => coordMap.has(id))
      .sort((a, b) => {
        const da = dateMap.get(a);
        const db = dateMap.get(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return new Date(da).getTime() - new Date(db).getTime();
      });
  } else {
    // Spatial mode: nearest-neighbor traversal
    const remaining = new Set(bookIds.filter((id) => coordMap.has(id)));
    if (remaining.size === 0) return [];

    // Start from centroid-nearest book
    let cx = 0, cy = 0, cz = 0;
    for (const id of remaining) {
      const c = coordMap.get(id)!;
      cx += c.x; cy += c.y; cz += c.z;
    }
    cx /= remaining.size; cy /= remaining.size; cz /= remaining.size;

    let nearest = "";
    let nearestDist = Infinity;
    for (const id of remaining) {
      const c = coordMap.get(id)!;
      const d = Math.sqrt((c.x - cx) ** 2 + (c.y - cy) ** 2 + (c.z - cz) ** 2);
      if (d < nearestDist) { nearestDist = d; nearest = id; }
    }

    orderedIds = [nearest];
    remaining.delete(nearest);

    while (remaining.size > 0) {
      const lastCoord = coordMap.get(orderedIds[orderedIds.length - 1])!;
      let bestId = "";
      let bestDist = Infinity;
      for (const id of remaining) {
        const c = coordMap.get(id)!;
        const d = Math.sqrt((c.x - lastCoord.x) ** 2 + (c.y - lastCoord.y) ** 2 + (c.z - lastCoord.z) ** 2);
        if (d < bestDist) { bestDist = d; bestId = id; }
      }
      orderedIds.push(bestId);
      remaining.delete(bestId);
    }
  }

  // Build path nodes
  const path: PathNode[] = orderedIds.map((id) => {
    const c = coordMap.get(id)!;
    return {
      bookId: id,
      title: titleMap.get(id) ?? "",
      x: c.x * WORLD_SCALE,
      y: c.y * WORLD_SCALE,
      z: c.z * WORLD_SCALE,
      readAt: dateMap.get(id) ?? null,
      daysGapToNext: null,
    };
  });

  // Compute days gaps
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].readAt && path[i + 1].readAt) {
      const d1 = new Date(path[i].readAt!).getTime();
      const d2 = new Date(path[i + 1].readAt!).getTime();
      path[i].daysGapToNext = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }
  }

  // Persist the path so it survives refresh and we can track history.
  // Non-blocking for the UI — fire and forget; errors logged but don't fail the path.
  void persistUserPath(supabase, userId, path, hasChronology);

  return path;
}

async function persistUserPath(
  supabase: Awaited<ReturnType<typeof createAuthClient>>,
  userId: string,
  path: PathNode[],
  hasChronology: boolean
): Promise<void> {
  if (path.length === 0) return;

  const algorithmType = hasChronology ? "chronology" : "spatial";
  const withDates = path.filter((n) => n.readAt).length;
  const coverage = withDates / path.length;
  const chronologyMode = coverage === 1 ? "full" : coverage > 0 ? "partial" : "none";

  const gaps = path.map((n) => n.daysGapToNext).filter((g): g is number => g !== null);
  const stats = {
    total: path.length,
    withDates,
    chronologyCoverage: Number(coverage.toFixed(2)),
    avgGapDays: gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    longestGapDays: gaps.length > 0 ? Math.max(...gaps) : null,
  };

  try {
    // Replace existing path for this user + algorithm (one live path per algo per user)
    await supabase
      .from("nb_user_paths")
      .delete()
      .eq("user_id", userId)
      .eq("algorithm_type", algorithmType);

    await supabase.from("nb_user_paths").insert({
      user_id: userId,
      algorithm_type: algorithmType,
      chronology_mode: chronologyMode,
      path_json: path,
      stats_json: stats,
    });
  } catch (err) {
    console.error("[persistUserPath] failed:", err);
  }
}

// --- Recommendations ---

export interface NebulaRecommendation {
  bookId: string;
  title: string;
  authorName: string | null;
  coverUrl: string | null;
  genre: string | null;
  score: number;
  reason: string;
}

export async function getNebulaRecommendations(): Promise<NebulaRecommendation[]> {
  const { userId } = await auth();
  if (!userId) return [];

  const supabase = await createAuthClient();

  // Get user's shelf
  const { data: userBooks } = await supabase
    .from("nb_user_books")
    .select("book_id")
    .eq("user_id", userId);

  if (!userBooks || userBooks.length === 0) return [];

  const shelfIds = new Set(userBooks.map((ub) => ub.book_id));
  const shelfList = [...shelfIds].slice(0, 100);

  // Get shelf books' coordinates and genres
  const [{ data: shelfCoords }, { data: shelfBooks }] = await Promise.all([
    supabase.from("nb_book_coordinates").select("book_id, x, y, z").in("book_id", shelfList),
    supabase.from("nb_books").select("id, canonical_genre").in("id", shelfList),
  ]);

  const shelfGenres = new Set((shelfBooks ?? []).map((b) => b.canonical_genre).filter(Boolean));

  // Compute shelf centroid
  let cx = 0, cy = 0, cz = 0;
  const sc = shelfCoords ?? [];
  for (const c of sc) { cx += Number(c.x); cy += Number(c.y); cz += Number(c.z); }
  if (sc.length > 0) { cx /= sc.length; cy /= sc.length; cz /= sc.length; }

  // Get all book coordinates (sample — limit to 1000 nearest to centroid for perf)
  const { data: allCoords } = await supabase
    .from("nb_book_coordinates")
    .select("book_id, x, y, z")
    .limit(1000);

  if (!allCoords) return [];

  // Score each non-shelf book by distance to centroid + genre match
  const candidates: { bookId: string; dist: number; genreMatch: boolean }[] = [];
  for (const c of allCoords) {
    if (shelfIds.has(c.book_id)) continue;
    const dx = Number(c.x) - cx;
    const dy = Number(c.y) - cy;
    const dz = Number(c.z) - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    candidates.push({ bookId: c.book_id, dist, genreMatch: false });
  }

  // Get genres for candidates
  const candIds = candidates.slice(0, 200).map((c) => c.bookId);
  const { data: candBooks } = await supabase
    .from("nb_books")
    .select("id, title, canonical_genre, cover_image_url, primary_author_id")
    .in("id", candIds);

  const candBookMap = new Map((candBooks ?? []).map((b) => [b.id, b]));

  // Score: lower distance = better, genre match = boost
  const scored = candidates.slice(0, 200).map((c) => {
    const book = candBookMap.get(c.bookId);
    const genreMatch = book?.canonical_genre ? shelfGenres.has(book.canonical_genre) : false;
    const score = 1 / (1 + c.dist) + (genreMatch ? 0.3 : 0);
    return { ...c, score, genreMatch, book };
  }).filter((c) => c.book).sort((a, b) => b.score - a.score).slice(0, 10);

  // Fetch author names
  const authorIds = scored.map((s) => s.book?.primary_author_id).filter(Boolean) as string[];
  const { data: authors } = authorIds.length > 0
    ? await supabase.from("nb_authors").select("id, name").in("id", authorIds)
    : { data: [] };
  const authorMap = new Map((authors ?? []).map((a) => [a.id, a.name]));

  return scored.map((s) => ({
    bookId: s.bookId,
    title: s.book!.title,
    authorName: s.book!.primary_author_id ? (authorMap.get(s.book!.primary_author_id) ?? null) : null,
    coverUrl: s.book!.cover_image_url,
    genre: s.book!.canonical_genre,
    score: Math.round(s.score * 100) / 100,
    reason: s.genreMatch
      ? `Near your shelf in ${s.book!.canonical_genre?.replace(":", " ").replace(/_/g, " ")}`
      : "Explores new territory near your reading",
  }));
}

// ============================================================
// Phase D: compounding-catalog server actions
// ============================================================

import {
  fetchGoogleBooksByIsbn,
  fetchGoogleBooksByTitleAuthor,
  fetchOpenLibraryByIsbn,
  fetchOpenLibraryByTitleAuthor,
  type ProviderRecord,
} from "@/lib/nebula/enrichment-client";
import { resolveWork } from "@/lib/nebula/dedupe";
import { seededCoordsFor } from "@/lib/nebula/seeded-coords";
import { normaliseTitle, normaliseAuthor } from "@/lib/nebula/title-normalise";
import { inferGenreFromSubjects, resolveRegionForGenre } from "@/lib/nebula/genre-mapping";
import { createHash } from "crypto";

/** Cached previewAddCandidates results younger than this skip the OL+GB fetch. */
const PROVIDER_CACHE_TTL_DAYS = 30;

export interface BookSearchHit {
  id: string;
  title: string;
  authorName: string | null;
  canonicalGenre: string | null;
  coverUrl: string | null;
  score: number;
}

/**
 * Trigram search over nb_books.title using the pg_trgm index added in 00300.
 * Called by the search UI when the in-memory filter returns < 3 results.
 */
export async function searchBooksByTitle(
  query: string,
  limit = 20,
): Promise<{ results: BookSearchHit[]; error?: string }> {
  const q = query.trim();
  if (q.length < 2) return { results: [] };

  const supabase = await createAuthClient();

  // Supabase JS doesn't expose pg_trgm's % operator directly, so we use ILIKE
  // + order by title length as a cheap proxy. The pg_trgm index still
  // accelerates the ILIKE under the hood. Phase E can add a proper RPC.
  const { data, error } = await supabase
    .from("nb_books")
    .select(
      "id, title, canonical_genre, cover_image_url, primary_author_id, popularity_score, engagement_score",
    )
    .ilike("title", `%${q}%`)
    .order("engagement_score", { ascending: false })
    .order("popularity_score", { ascending: false })
    .limit(limit);

  if (error) return { results: [], error: error.message };
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const authorIds = Array.from(
    new Set(rows.map((r) => r.primary_author_id).filter((x): x is string => !!x)),
  );
  const authorMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: authors } = await supabase
      .from("nb_authors")
      .select("id, name")
      .in("id", authorIds);
    for (const a of (authors ?? []) as Array<{ id: string; name: string }>) {
      authorMap.set(a.id, a.name);
    }
  }

  // Local scoring: exact-prefix > substring > anything else.
  const qLower = q.toLowerCase();
  const scored = rows.map((r) => {
    const title = String(r.title ?? "").toLowerCase();
    let score = 0.3;
    if (title === qLower) score = 1.0;
    else if (title.startsWith(qLower)) score = 0.9;
    else if (title.includes(qLower)) score = 0.7;
    return {
      id: r.id as string,
      title: r.title as string,
      canonicalGenre: (r.canonical_genre as string | null) ?? null,
      coverUrl: (r.cover_image_url as string | null) ?? null,
      authorName: r.primary_author_id ? (authorMap.get(r.primary_author_id as string) ?? null) : null,
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return { results: scored };
}

export interface ProviderCandidate {
  provider: "openlibrary" | "google_books";
  provider_record_id: string;
  title: string;
  authorName: string | null;
  year: number | null;
  coverUrl: string | null;
  description: string | null;
  isbn13: string | null;
  isbn10: string | null;
  /** OpenLibrary `subjects` / Google Books `categories`, normalised to a
   *  flat list of strings. Used by inferGenreFromSubjects to pick the
   *  right region for the new shell. Older cache rows may not have it;
   *  treat undefined as []. */
  subjects: string[];
  raw: unknown;
}

/**
 * Fetches top candidates from OpenLibrary + Google Books for a user who's
 * adding a brand-new work via the "Add to universe" flow.
 *
 * Read-through cache via nb_provider_lookup_cache: identical title+author
 * queries within PROVIDER_CACHE_TTL_DAYS skip the OL+GB roundtrip entirely.
 * Writes happen on every cache miss, including when the user doesn't end up
 * picking a candidate — that's the whole point of the cache (compounding).
 */
export async function previewAddCandidates(
  title: string,
  author?: string,
): Promise<{ candidates: ProviderCandidate[] }> {
  const authorArg = author ?? "";
  const normTitle = normaliseTitle(title);
  const normAuthor = normaliseAuthor(authorArg);
  // Empty normalised title (e.g. only-punctuation input) is unusable for the
  // cache key. Skip the cache entirely; downstream fetchers will return
  // nothing meaningful anyway.
  const cacheable = normTitle.length > 0;
  const queryHash = cacheable
    ? createHash("sha256").update(`${normTitle}|${normAuthor}`).digest("hex")
    : "";

  // Service client because nb_provider_lookup_cache has service-role-only RLS.
  const supabase = createServiceClient();

  if (cacheable) {
    const ttlCutoff = new Date(
      Date.now() - PROVIDER_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: cached } = await supabase
      .from("nb_provider_lookup_cache")
      .select("raw_candidates")
      .eq("query_hash", queryHash)
      .gte("fetched_at", ttlCutoff)
      .maybeSingle();
    if (cached?.raw_candidates) {
      // Stored shape is the same ProviderCandidate[] returned to clients,
      // so we can return it straight through without re-deriving.
      return { candidates: cached.raw_candidates as ProviderCandidate[] };
    }
  }

  const [ol, gb] = await Promise.all([
    fetchOpenLibraryByTitleAuthor(title, authorArg),
    fetchGoogleBooksByTitleAuthor(title, authorArg),
  ]);

  const out: ProviderCandidate[] = [];
  for (const rec of [ol, gb]) {
    if (!rec) continue;
    out.push(providerRecordToCandidate(rec));
  }

  if (cacheable) {
    // Upsert so a retry after partial provider failure refreshes the cache
    // rather than failing on a primary-key conflict. fetched_at is refreshed
    // by the upsert which is what we want — TTL is measured from the most
    // recent successful fetch.
    await supabase
      .from("nb_provider_lookup_cache")
      .upsert(
        {
          query_hash: queryHash,
          query_text: `${normTitle}|${normAuthor}`,
          raw_candidates: out,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "query_hash" },
      );
  }

  return { candidates: out };
}

function providerRecordToCandidate(rec: ProviderRecord): ProviderCandidate {
  return {
    provider: rec.provider as "openlibrary" | "google_books",
    provider_record_id: rec.provider_record_id,
    title: rec.fields.title ?? "Unknown",
    authorName: rec.fields.primary_author ?? null,
    year: rec.fields.publication_year ?? null,
    coverUrl: rec.fields.cover_image_url ?? null,
    description: rec.fields.description ?? null,
    isbn13: rec.fields.isbn_13 ?? null,
    isbn10: rec.fields.isbn_10 ?? null,
    subjects: rec.fields.tags ?? [],
    raw: rec.raw,
  };
}

export interface CreatedShell {
  bookId: string;
  title: string;
  authorName: string | null;
  canonicalGenre: string | null;
  coverUrl: string | null;
  justCreated: boolean;
  publicationYear: number | null;
  pageCount: number | null;
  seriesId: string | null;
  seriesOrder: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  regionId: string | null;
  popularityScore: number;
}

/**
 * Create a shell work from a provider record (or dedupe to an existing one).
 * Used by the Add-to-Universe dialog and ISBN-miss flow.
 *
 * Uses the service-role client because the compounding catalog tables
 * (nb_books, nb_authors, nb_editions, nb_enrichment_*, nb_book_coordinates)
 * are write-protected by default RLS. User authentication is gated by
 * auth() at the top — so the write is still tied to a signed-in request.
 */
export async function createShellFromProvider(
  candidate: ProviderCandidate,
  hint?: { canonicalGenre?: string },
): Promise<{ shell?: CreatedShell; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };
  const supabase = createServiceClient();

  // Dedupe: if there's a confident match (ISBN, normalised, or trigram_auto),
  // just return it. If the match is in the gray zone (trigram_review at
  // 0.60-0.78 similarity), we record a review-queue row and still create the
  // requested shell so the user's flow isn't blocked.
  const existing = await resolveWork(supabase, {
    isbn13: candidate.isbn13,
    isbn10: candidate.isbn10,
    title: candidate.title,
    author: candidate.authorName ?? "",
  });
  let reviewCanonicalWorkId: string | null = null;
  let reviewSimilarity: number | null = null;
  if (existing) {
    if (existing.matchType === "trigram_review") {
      // Defer the merge decision to an admin; create a fresh shell and queue.
      reviewCanonicalWorkId = existing.workId;
      reviewSimilarity = existing.confidence;
    } else {
      const shell = await hydrateExistingShell(supabase, existing.workId, candidate.title);
      return { shell };
    }
  }

  // Author: lookup-or-create.
  const rawAuthor = (candidate.authorName ?? "").trim();
  let authorId: string | null = null;
  if (rawAuthor) {
    const { data: existingAuthor } = await supabase
      .from("nb_authors")
      .select("id")
      .eq("name", rawAuthor)
      .maybeSingle();
    if (existingAuthor?.id) {
      authorId = existingAuthor.id as string;
    } else {
      const { data: created } = await supabase
        .from("nb_authors")
        .insert({ name: rawAuthor, sort_name: rawAuthor })
        .select("id")
        .single();
      authorId = (created?.id as string) ?? null;
    }
  }

  // Region: hint (explicit caller override) wins. Otherwise infer from
  // the candidate's subjects + title via lib/nebula/genre-mapping. See
  // ADR-007 plan section / the genre-mapping module for the heuristic.
  // Old regex-based matcher (replaced) defaulted EVERY new shell to the
  // first fantasy region (mythic-fantasy by sort_order) which is why
  // CSV-imported books all ended up in one cluster regardless of genre.
  const canonicalGenre =
    hint?.canonicalGenre ?? inferGenreFromSubjects(candidate.subjects, candidate.title);
  const { data: regions } = await supabase
    .from("nb_regions")
    .select("id, name, slug, anchor_x, anchor_y, anchor_z");
  const regionRow =
    resolveRegionForGenre(canonicalGenre, (regions ?? []) as Array<{ id: string; slug: string | null; name: string; anchor_x: number; anchor_y: number; anchor_z: number }>) ??
    // Defensive fallback: if even the "fantasy" → epic-fantasy slug isn't
    // in the regions table (i.e. seeding hasn't run yet), grab the first
    // region we do have. Migration 00410 makes this branch unreachable
    // on a properly-migrated DB.
    (regions ?? [])[0];

  const slug = `${slugify(candidate.title)}-${Date.now().toString(36)}`;

  const provenance: Record<string, { tier: number; provider: string }> = {
    title: { tier: 2, provider: candidate.provider },
    publication_year: { tier: 2, provider: candidate.provider },
  };
  if (candidate.isbn13) provenance.isbn_13 = { tier: 2, provider: candidate.provider };
  if (candidate.isbn10) provenance.isbn_10 = { tier: 2, provider: candidate.provider };
  if (candidate.coverUrl) provenance.cover_image_url = { tier: 2, provider: candidate.provider };

  const externalIds: Record<string, unknown> = { provenance };
  if (candidate.provider === "openlibrary") {
    externalIds.openlibrary = { work_id: candidate.provider_record_id };
  } else if (candidate.provider === "google_books") {
    externalIds.google_books = { volume_id: candidate.provider_record_id };
  }

  const { data: bookRow, error: insertErr } = await supabase
    .from("nb_books")
    .insert({
      title: candidate.title,
      slug,
      publication_year: candidate.year,
      original_publication_year: candidate.year,
      isbn_13: candidate.isbn13,
      isbn_10: candidate.isbn10,
      cover_image_url: candidate.coverUrl,
      canonical_genre: canonicalGenre,
      primary_author_id: authorId,
      popularity_score: 0,
      quality_score: 0,
      external_ids: externalIds,
    })
    .select("id")
    .single<{ id: string }>();
  if (insertErr || !bookRow) {
    return { error: `shell insert failed: ${insertErr?.message ?? "unknown"}` };
  }
  const bookId = bookRow.id;

  // Edition (only if we have an ISBN).
  if (candidate.isbn13 || candidate.isbn10) {
    await supabase.from("nb_editions").insert({
      work_id: bookId,
      isbn_13: candidate.isbn13,
      isbn_10: candidate.isbn10,
      publication_year: candidate.year,
      source: candidate.provider,
    });
  }

  // nb_book_authors junction.
  if (authorId) {
    await supabase
      .from("nb_book_authors")
      .insert({ book_id: bookId, author_id: authorId, role: "author", ordinal: 1 });
  }

  // Enrichment status: shell, pending metadata enrichment via worker.
  await supabase.from("nb_enrichment_status").upsert({
    work_id: bookId,
    metadata_status: "shell",
    embedding_status: "shell",
    coords_status: "seeded",
    cover_status: candidate.coverUrl ? "present" : "missing",
  });

  // Seeded coords.
  let coordX: number | null = null;
  let coordY: number | null = null;
  let coordZ: number | null = null;
  let coordRegionId: string | null = null;
  if (regionRow) {
    const coords = seededCoordsFor(
      {
        id: regionRow.id as string,
        anchor_x: Number(regionRow.anchor_x),
        anchor_y: Number(regionRow.anchor_y),
        anchor_z: Number(regionRow.anchor_z),
      },
      canonicalGenre,
      rawAuthor,
    );
    coordX = coords.x;
    coordY = coords.y;
    coordZ = coords.z;
    coordRegionId = regionRow.id as string;
    await supabase.from("nb_book_coordinates").upsert({
      book_id: bookId,
      region_id: regionRow.id as string,
      layout_version: "v1",
      x: coords.x,
      y: coords.y,
      z: coords.z,
    });
  }

  // Enqueue enrichment jobs: metadata will cascade to embedding + cover + coords.
  await supabase.from("nb_enrichment_jobs").insert({
    work_id: bookId,
    job_type: "metadata",
    priority: 30, // user-triggered → higher priority than background seed jobs
  });

  // If the dedupe came back with a gray-zone match, record a review row so
  // an admin can later confirm whether to merge this new shell into the
  // existing book or keep them as distinct works.
  if (reviewCanonicalWorkId) {
    await supabase.from("nb_review_queue").insert({
      source: "external_match",
      canonical_work_id: reviewCanonicalWorkId,
      duplicate_work_id: bookId,
      similarity: reviewSimilarity,
      signal_breakdown: { trigram: reviewSimilarity },
      incoming_title: candidate.title,
      incoming_author: candidate.authorName,
      incoming_isbn_13: candidate.isbn13,
      incoming_external_ids: externalIds,
      status: "pending",
    });
  }

  return {
    shell: {
      bookId,
      title: candidate.title,
      authorName: rawAuthor || null,
      canonicalGenre,
      coverUrl: candidate.coverUrl,
      justCreated: true,
      publicationYear: candidate.year,
      pageCount: null,
      seriesId: null,
      seriesOrder: null,
      x: coordX,
      y: coordY,
      z: coordZ,
      regionId: coordRegionId,
      popularityScore: 0,
    },
  };
}

/**
 * Hydrate a CreatedShell for a work that already exists (dedupe hit).
 * Reads book + coords so the UI can fly to an existing entry.
 */
async function hydrateExistingShell(
  supabase: Awaited<ReturnType<typeof createAuthClient>>,
  workId: string,
  fallbackTitle: string,
): Promise<CreatedShell> {
  const { data: book } = await supabase
    .from("nb_books")
    .select(
      "id, title, canonical_genre, cover_image_url, primary_author_id, publication_year, page_count, series_id, series_order, popularity_score",
    )
    .eq("id", workId)
    .single<{
      id: string;
      title: string;
      canonical_genre: string | null;
      cover_image_url: string | null;
      primary_author_id: string | null;
      publication_year: number | null;
      page_count: number | null;
      series_id: string | null;
      series_order: number | null;
      popularity_score: number;
    }>();
  let authorName: string | null = null;
  if (book?.primary_author_id) {
    const { data: a } = await supabase
      .from("nb_authors")
      .select("name")
      .eq("id", book.primary_author_id)
      .single<{ name: string }>();
    authorName = a?.name ?? null;
  }
  const { data: coord } = await supabase
    .from("nb_book_coordinates")
    .select("x, y, z, region_id")
    .eq("book_id", workId)
    .maybeSingle<{ x: number; y: number; z: number; region_id: string | null }>();

  return {
    bookId: workId,
    title: book?.title ?? fallbackTitle,
    authorName,
    canonicalGenre: book?.canonical_genre ?? null,
    coverUrl: book?.cover_image_url ?? null,
    justCreated: false,
    publicationYear: book?.publication_year ?? null,
    pageCount: book?.page_count ?? null,
    seriesId: book?.series_id ?? null,
    seriesOrder: book?.series_order ?? null,
    x: coord?.x ?? null,
    y: coord?.y ?? null,
    z: coord?.z ?? null,
    regionId: coord?.region_id ?? null,
    popularityScore: Number(book?.popularity_score ?? 0),
  };
}

/**
 * ISBN-miss flow: check nb_books, then nb_editions, then (if createIfMiss) hit
 * external providers and create a shell. Used by the barcode scanner.
 */
export async function resolveIsbnOrShell(
  isbn: string,
  opts: { createIfMiss?: boolean } = {},
): Promise<{ shell?: CreatedShell; error?: string }> {
  const cleaned = isbn.replace(/[^0-9X]/gi, "").toUpperCase();
  if (cleaned.length !== 10 && cleaned.length !== 13) {
    return { error: "Invalid ISBN" };
  }
  // Service client: dedupe + potential shell creation both happen here.
  // Read paths use the same client for simplicity; RLS read policy is
  // open-read to authenticated anyway.
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };
  const supabase = createServiceClient();

  const existing = await resolveWork(supabase, {
    isbn13: cleaned.length === 13 ? cleaned : null,
    isbn10: cleaned.length === 10 ? cleaned : null,
    title: "",
    author: "",
  });

  if (existing) {
    const shell = await hydrateExistingShell(supabase, existing.workId, "Unknown");
    return { shell };
  }

  if (!opts.createIfMiss) return {};

  // Hit external providers.
  const [ol, gb] = await Promise.all([
    fetchOpenLibraryByIsbn(cleaned),
    fetchGoogleBooksByIsbn(cleaned),
  ]);
  const rec = ol ?? gb;
  if (!rec) return {};

  const candidate = providerRecordToCandidate(rec);
  return createShellFromProvider(candidate);
}

export type PopularitySignalType =
  | "view"
  | "click"
  | "upload"
  | "search_hit"
  | "wishlist"
  | "read";

/**
 * Append-only signal insert. Cheap; no rate limiting here — client-side
 * throttles views and search_hits.
 */
export async function emitPopularitySignal(
  bookId: string,
  signalType: PopularitySignalType,
  weight?: number,
): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  const supabase = await createAuthClient();
  await supabase.from("nb_popularity_signals").insert({
    work_id: bookId,
    signal_type: signalType,
    user_id: userId ?? null,
    weight: weight ?? defaultWeight(signalType),
  });
  return { ok: true };
}

function defaultWeight(t: PopularitySignalType): number {
  switch (t) {
    case "upload": return 5;
    case "wishlist": return 3;
    case "read": return 3;
    case "click": return 1;
    case "view": return 0.3;
    case "search_hit": return 0.1;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ============================================================
// Phase E.3: admin review queue
// ============================================================

import { requireAdmin } from "@/lib/nebula/admin";

export interface ReviewQueueItem {
  id: string;
  source: "duplicate" | "external_match";
  status: "pending" | "merged" | "dismissed" | "created_separate";
  similarity: number | null;
  signal_breakdown: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  canonical: ReviewQueueBookSide | null;
  duplicate: ReviewQueueBookSide | null;
  /** For external_match rows where we may not have a duplicate work yet. */
  incoming: {
    title: string | null;
    author: string | null;
    isbn_13: string | null;
    external_ids: Record<string, unknown> | null;
  } | null;
}

export interface ReviewQueueBookSide {
  id: string;
  title: string;
  author_name: string | null;
  publication_year: number | null;
  cover_image_url: string | null;
  popularity_score: number;
  engagement_score: number;
  isbn_13: string | null;
  isbn_10: string | null;
}

export async function listReviewQueue(opts: {
  status?: "pending" | "merged" | "dismissed" | "created_separate";
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: ReviewQueueItem[]; total: number; error?: string }> {
  try {
    await requireAdmin();
  } catch (e) {
    return { items: [], total: 0, error: (e as Error).message };
  }

  const supabase = createServiceClient();
  const status = opts.status ?? "pending";
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const { data: rows, count, error } = await supabase
    .from("nb_review_queue")
    .select(
      "id, source, status, similarity, signal_breakdown, notes, created_at, resolved_at, resolved_by, canonical_work_id, duplicate_work_id, incoming_title, incoming_author, incoming_isbn_13, incoming_external_ids",
      { count: "exact" },
    )
    .eq("status", status)
    .order("similarity", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return { items: [], total: 0, error: error.message };

  const queueRows = (rows ?? []) as Array<Record<string, unknown>>;
  const workIds = new Set<string>();
  for (const r of queueRows) {
    if (r.canonical_work_id) workIds.add(r.canonical_work_id as string);
    if (r.duplicate_work_id) workIds.add(r.duplicate_work_id as string);
  }

  const bookSides = new Map<string, ReviewQueueBookSide>();
  if (workIds.size > 0) {
    const { data: books } = await supabase
      .from("nb_books")
      .select(
        "id, title, primary_author_id, publication_year, cover_image_url, popularity_score, engagement_score, isbn_13, isbn_10",
      )
      .in("id", Array.from(workIds));
    const authorIds = new Set<string>();
    for (const b of (books ?? []) as Array<Record<string, unknown>>) {
      if (b.primary_author_id) authorIds.add(b.primary_author_id as string);
    }
    const authorMap = new Map<string, string>();
    if (authorIds.size > 0) {
      const { data: authors } = await supabase
        .from("nb_authors")
        .select("id, name")
        .in("id", Array.from(authorIds));
      for (const a of (authors ?? []) as Array<{ id: string; name: string }>) {
        authorMap.set(a.id, a.name);
      }
    }
    for (const b of (books ?? []) as Array<Record<string, unknown>>) {
      bookSides.set(b.id as string, {
        id: b.id as string,
        title: (b.title as string) ?? "",
        author_name: b.primary_author_id ? authorMap.get(b.primary_author_id as string) ?? null : null,
        publication_year: (b.publication_year as number | null) ?? null,
        cover_image_url: (b.cover_image_url as string | null) ?? null,
        popularity_score: Number(b.popularity_score ?? 0),
        engagement_score: Number(b.engagement_score ?? 0),
        isbn_13: (b.isbn_13 as string | null) ?? null,
        isbn_10: (b.isbn_10 as string | null) ?? null,
      });
    }
  }

  const items: ReviewQueueItem[] = queueRows.map((r) => ({
    id: r.id as string,
    source: r.source as "duplicate" | "external_match",
    status: r.status as ReviewQueueItem["status"],
    similarity: r.similarity != null ? Number(r.similarity) : null,
    signal_breakdown: (r.signal_breakdown as Record<string, unknown> | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    created_at: r.created_at as string,
    resolved_at: (r.resolved_at as string | null) ?? null,
    resolved_by: (r.resolved_by as string | null) ?? null,
    canonical: r.canonical_work_id ? bookSides.get(r.canonical_work_id as string) ?? null : null,
    duplicate: r.duplicate_work_id ? bookSides.get(r.duplicate_work_id as string) ?? null : null,
    incoming:
      r.incoming_title || r.incoming_author || r.incoming_isbn_13
        ? {
            title: (r.incoming_title as string | null) ?? null,
            author: (r.incoming_author as string | null) ?? null,
            isbn_13: (r.incoming_isbn_13 as string | null) ?? null,
            external_ids: (r.incoming_external_ids as Record<string, unknown> | null) ?? null,
          }
        : null,
  }));

  return { items, total: count ?? items.length };
}

export async function mergeReviewItem(
  reviewId: string,
  keepCanonical: "left" | "right",
): Promise<{ ok: boolean; error?: string }> {
  let userId: string;
  try {
    ({ userId } = await requireAdmin());
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("nb_review_queue")
    .select("id, canonical_work_id, duplicate_work_id, status")
    .eq("id", reviewId)
    .single<{
      id: string;
      canonical_work_id: string | null;
      duplicate_work_id: string | null;
      status: string;
    }>();
  if (!row) return { ok: false, error: "review item not found" };
  if (row.status !== "pending") return { ok: false, error: `already ${row.status}` };
  if (!row.canonical_work_id || !row.duplicate_work_id) {
    return { ok: false, error: "review item missing both work ids; cannot merge" };
  }

  // Decide which side becomes canonical based on the admin's choice.
  const canonicalId = keepCanonical === "left" ? row.canonical_work_id : row.duplicate_work_id;
  const duplicateId = keepCanonical === "left" ? row.duplicate_work_id : row.canonical_work_id;

  const { error: rpcErr } = await supabase.rpc("nb_merge_works", {
    p_canonical_id: canonicalId,
    p_duplicate_id: duplicateId,
  });
  if (rpcErr) return { ok: false, error: `merge failed: ${rpcErr.message}` };

  await supabase
    .from("nb_review_queue")
    .update({
      status: "merged",
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      // After merge, both old IDs may point to canonical for traceability;
      // canonical_work_id stays as the surviving row.
      canonical_work_id: canonicalId,
      duplicate_work_id: null,
    })
    .eq("id", reviewId);

  return { ok: true };
}

export async function dismissReviewItem(
  reviewId: string,
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  let userId: string;
  try {
    ({ userId } = await requireAdmin());
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("nb_review_queue")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      notes: notes ?? null,
    })
    .eq("id", reviewId)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Fetch the enrichment status for a book. Used by BookDetailPanel to decide
 * whether to show the "Enriching…" shimmer and whether to subscribe to updates.
 */
export async function getEnrichmentStatus(
  bookId: string,
): Promise<{
  metadata_status: string;
  embedding_status: string;
  coords_status: string;
  cover_status: string;
} | null> {
  const supabase = await createAuthClient();
  const { data } = await supabase
    .from("nb_enrichment_status")
    .select("metadata_status, embedding_status, coords_status, cover_status")
    .eq("work_id", bookId)
    .maybeSingle<{
      metadata_status: string;
      embedding_status: string;
      coords_status: string;
      cover_status: string;
    }>();
  return data ?? null;
}
