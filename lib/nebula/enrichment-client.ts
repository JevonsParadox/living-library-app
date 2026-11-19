/**
 * Normalised external-source fetchers for enrichment.
 * Each provider returns either a ProviderRecord or null (never throws).
 *
 * Rate limits: per-provider token buckets, tuned to each provider's docs.
 * Cache: tiny in-process LRU (worker-local), TTL 10 min. Not a substitute for
 * the persistent write-back in nb_source_records — just avoids duplicate hits
 * within a single worker pass.
 */

export type ProviderName = "openlibrary" | "google_books" | "isfdb" | "llm" | "user";

export interface ProviderFields {
  title?: string;
  primary_author?: string;
  publication_year?: number;
  description?: string;
  isbn_13?: string;
  isbn_10?: string;
  page_count?: number;
  publisher?: string;
  cover_image_url?: string;
  tags?: string[];
  series_name?: string;
  series_order?: number;
}

export interface ProviderRecord {
  provider: ProviderName;
  provider_record_id: string;
  fields: ProviderFields;
  raw: unknown;
}

// --- Rate limiter (token bucket) ---

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 / this.refillPerSec) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
  }
}

const buckets: Record<ProviderName, TokenBucket> = {
  openlibrary: new TokenBucket(6, 3),   // 3 rps steady, burst 6
  google_books: new TokenBucket(10, 5), // 5 rps steady, burst 10
  isfdb: new TokenBucket(1, 1),         // stub
  llm: new TokenBucket(10, 10),
  user: new TokenBucket(1, 1),
};

// --- LRU cache ---

class Lru<K, V> {
  private map = new Map<K, { v: V; t: number }>();
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}
  get(k: K): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (Date.now() - hit.t > this.ttlMs) {
      this.map.delete(k);
      return undefined;
    }
    // Refresh LRU order.
    this.map.delete(k);
    this.map.set(k, hit);
    return hit.v;
  }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { v, t: Date.now() });
    if (this.map.size > this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
  }
}

const responseCache = new Lru<string, ProviderRecord | null>(200, 10 * 60_000);

// --- HTTP helpers ---

const USER_AGENT = "LivingLibrary/0.1 (+contact@example.com.au)";

async function fetchJson<T>(url: string, provider: ProviderName): Promise<T | null> {
  const cacheKey = `${provider}:${url}`;
  const cached = responseCache.get(cacheKey);
  if (cached !== undefined) {
    return cached ? (cached.raw as T) : null;
  }

  await buckets[provider].take();

  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- OpenLibrary ---

const OL_BASE = "https://openlibrary.org";

interface OLEdition {
  title?: string;
  publishers?: string[];
  publish_date?: string;
  number_of_pages?: number;
  works?: { key: string }[];
  authors?: { key: string }[];
  covers?: number[];
  isbn_13?: string[];
  isbn_10?: string[];
}
interface OLWork {
  title?: string;
  description?: string | { value: string };
  subjects?: string[];
  first_publish_date?: string;
}
interface OLAuthor {
  name?: string;
}

export async function fetchOpenLibraryByIsbn(isbn: string): Promise<ProviderRecord | null> {
  const edition = await fetchJson<OLEdition>(`${OL_BASE}/isbn/${isbn}.json`, "openlibrary");
  if (!edition) return null;

  let work: OLWork | null = null;
  let workKey: string | null = null;
  if (edition.works?.[0]?.key) {
    workKey = edition.works[0].key;
    work = await fetchJson<OLWork>(`${OL_BASE}${workKey}.json`, "openlibrary");
  }

  let authorName: string | null = null;
  if (edition.authors?.[0]?.key) {
    const author = await fetchJson<OLAuthor>(
      `${OL_BASE}${edition.authors[0].key}.json`,
      "openlibrary",
    );
    authorName = author?.name ?? null;
  }

  const description = typeof work?.description === "string"
    ? work.description
    : work?.description?.value ?? undefined;

  const publishYear = parsePublishYear(edition.publish_date) ?? parsePublishYear(work?.first_publish_date);

  const fields: ProviderFields = {
    title: edition.title ?? work?.title,
    primary_author: authorName ?? undefined,
    publication_year: publishYear,
    description,
    isbn_13: edition.isbn_13?.[0],
    isbn_10: edition.isbn_10?.[0],
    page_count: edition.number_of_pages,
    publisher: edition.publishers?.[0],
    cover_image_url: edition.covers?.[0]
      ? `https://covers.openlibrary.org/b/id/${edition.covers[0]}-L.jpg`
      : undefined,
    tags: work?.subjects?.slice(0, 20),
  };

  return {
    provider: "openlibrary",
    provider_record_id: workKey ?? `isbn:${isbn}`,
    fields,
    raw: { edition, work },
  };
}

interface OLSearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  number_of_pages_median?: number;
  subject?: string[];
  isbn?: string[];
  cover_i?: number;
}
interface OLSearchResponse {
  docs: OLSearchDoc[];
}

export async function fetchOpenLibraryByTitleAuthor(
  title: string,
  author: string,
): Promise<ProviderRecord | null> {
  const params = new URLSearchParams({
    title,
    author,
    limit: "1",
    fields: "key,title,author_name,first_publish_year,publisher,number_of_pages_median,subject,isbn,cover_i",
  });
  const resp = await fetchJson<OLSearchResponse>(
    `${OL_BASE}/search.json?${params.toString()}`,
    "openlibrary",
  );
  const doc = resp?.docs?.[0];
  if (!doc) return null;

  const fields: ProviderFields = {
    title: doc.title,
    primary_author: doc.author_name?.[0],
    publication_year: doc.first_publish_year,
    publisher: doc.publisher?.[0],
    page_count: doc.number_of_pages_median,
    tags: doc.subject?.slice(0, 20),
    isbn_13: doc.isbn?.find((x) => x.length === 13),
    isbn_10: doc.isbn?.find((x) => x.length === 10),
    cover_image_url: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : undefined,
  };
  return {
    provider: "openlibrary",
    provider_record_id: doc.key,
    fields,
    raw: doc,
  };
}

// --- Google Books ---

const GB_BASE = "https://www.googleapis.com/books/v1/volumes";

interface GBVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    imageLinks?: { thumbnail?: string; small?: string; medium?: string; large?: string };
    industryIdentifiers?: { type: string; identifier: string }[];
  };
}
interface GBResponse {
  items?: GBVolume[];
}

function gbApiKey(): string | null {
  return process.env.GOOGLE_BOOKS_API_KEY ?? null;
}

function gbVolumeToRecord(v: GBVolume): ProviderRecord {
  const info = v.volumeInfo ?? {};
  const ids = info.industryIdentifiers ?? [];
  const cover =
    info.imageLinks?.large ??
    info.imageLinks?.medium ??
    info.imageLinks?.small ??
    info.imageLinks?.thumbnail;
  const fields: ProviderFields = {
    title: info.title,
    primary_author: info.authors?.[0],
    publisher: info.publisher,
    publication_year: parsePublishYear(info.publishedDate),
    description: info.description,
    page_count: info.pageCount,
    tags: info.categories,
    isbn_13: ids.find((x) => x.type === "ISBN_13")?.identifier,
    isbn_10: ids.find((x) => x.type === "ISBN_10")?.identifier,
    cover_image_url: cover?.replace("http://", "https://"),
  };
  return { provider: "google_books", provider_record_id: v.id, fields, raw: v };
}

export async function fetchGoogleBooksByIsbn(isbn: string): Promise<ProviderRecord | null> {
  const key = gbApiKey();
  const url = `${GB_BASE}?q=isbn:${encodeURIComponent(isbn)}${key ? `&key=${key}` : ""}`;
  const resp = await fetchJson<GBResponse>(url, "google_books");
  const v = resp?.items?.[0];
  return v ? gbVolumeToRecord(v) : null;
}

export async function fetchGoogleBooksByTitleAuthor(
  title: string,
  author: string,
): Promise<ProviderRecord | null> {
  const key = gbApiKey();
  const q = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
  const url = `${GB_BASE}?q=${q}&maxResults=1${key ? `&key=${key}` : ""}`;
  const resp = await fetchJson<GBResponse>(url, "google_books");
  const v = resp?.items?.[0];
  return v ? gbVolumeToRecord(v) : null;
}

// --- ISFDB (Phase C) ---

/**
 * Stub: wired in Phase C once the MySQL dump is imported.
 * Returning null here forces the worker to fall through to OpenLibrary/Google Books.
 */
export async function fetchIsfdbLocal(_titleId: number | string): Promise<ProviderRecord | null> {
  return null;
}

// --- Helpers ---

function parsePublishYear(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const match = input.match(/\d{4}/);
  if (!match) return undefined;
  const n = Number.parseInt(match[0], 10);
  if (Number.isNaN(n) || n < 1400 || n > 2100) return undefined;
  return n;
}

/**
 * HEAD a URL to confirm it returns a real (non-placeholder) image.
 * Used by the cover job to validate OpenLibrary covers. Returns null on any failure.
 */
export async function headImage(url: string): Promise<{ ok: true; bytes: number } | null> {
  try {
    await buckets.openlibrary.take();
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    return { ok: true, bytes: len };
  } catch {
    return null;
  }
}
