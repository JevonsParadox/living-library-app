/**
 * Open Library API client for book search, ISBN lookup, and subject mapping.
 * Used by all capture methods (search, shelf scan, barcode, CSV import).
 */

// --- Types ---

export interface OLSearchResult {
  title: string;
  author: string;
  isbn: string | null;
  coverUrl: string | null;
  publishedYear: number | null;
  publisher: string | null;
  pageCount: number | null;
  subjects: string[];
  olKey: string | null;
}

export interface OLBookDetail extends OLSearchResult {
  description: string | null;
}

// --- Subject mapping ---

const SUBJECT_KEYWORDS: [RegExp, string][] = [
  [/\bscience fiction\b|\bsci-fi\b|\bsci fi\b/i, "Science Fiction"],
  [/\bfantasy\b/i, "Fantasy"],
  [/\bmystery\b|\bdetective\b|\bcrime fiction\b/i, "Mystery"],
  [/\bhorror\b/i, "Horror"],
  [/\bthriller\b|\bsuspense\b/i, "Thriller"],
  [/\bromance\b/i, "Romance"],
  [/\badventure\b/i, "Adventure"],
  [/\byoung adult\b|\bYA\b|\bchildren\b|\bjuvenile\b/i, "Young Adult"],
  [/\bclassic\b|\bliterary fiction\b|\bliterature\b/i, "Classic Literature"],
  [/\bphilosoph/i, "Philosophy"],
  [/\bpsycholog/i, "Psychology"],
  [/\bhistor/i, "History"],
  [/\beconom|\bfinance\b|\bmoney\b/i, "Economics"],
  [/\bscience\b|\bphysics\b|\bbiology\b|\bchemistry\b|\bmathematic/i, "Science"],
  [/\bbiograph|\bmemoir|\bautobiograph/i, "Biography"],
  [/\bbusiness\b|\bmanagement\b|\bentrepreneur|\bstartup/i, "Business"],
  [/\btechnolog|\bcomputer|\bprogramming|\bsoftware|\bartificial intelligence/i, "Technology"],
  [/\bself.help\b|\bself.improvement\b|\bpersonal development/i, "Self Help"],
  [/\bpolitic|\bgovernment\b|\bdemocra|\bdictat/i, "Politics"],
  [/\bfiction\b/i, "Fiction"],
];

const THEME_KEYWORDS: [RegExp, string][] = [
  [/\bdystopi|\btotalitari|\bsurveillance\b|\borwellian/i, "dystopia"],
  [/\btime travel|\btime loop|\bchrono/i, "time travel"],
  [/\bartificial intelligence\b|\brobots?\b|\bmachine learning\b|\bandroid|\bcyborg/i, "artificial intelligence"],
  [/\bidentity\b|\bself.discover|\bcoming.of.age|\bbildungsroman/i, "identity"],
  [/\bcolonial|\bimperial|\bpostcolonial|\bempire/i, "colonialism"],
  [/\brevolution|\brebellion\b|\bresistance\b|\binsurrection/i, "revolution"],
  [/\bconsciousness\b|\bmind\b|\bawareness\b|\bperception/i, "consciousness"],
  [/\bevolution|\bnatural selection|\bdarwin|\badaptation/i, "evolution"],
  [/\bdeath\b|\bmortalit|\bgrief\b|\bafterlife\b|\bdying\b/i, "mortality"],
  [/\blove\b.*\bloss\b|\bheartbreak|\bbereavement|\bgrief.*love/i, "love and loss"],
  [/\bpower\b.*\bcorrupt|\btyrann|\bauthoritarian|\bdespoti/i, "power and corruption"],
  [/\bfreedom\b|\bliberty\b|\bemancipat|\bindependence/i, "freedom"],
  [/\bmemory\b|\bremember|\bnostalg|\bamnesia|\brecollect/i, "memory"],
  [/\bsolitude\b|\bisolat|\bloneli|\bhermit/i, "solitude"],
  [/\bhuman nature\b|\bhuman condition\b|\bwhat it means to be human/i, "human nature"],
  [/\bjustice\b|\blaw\b.*\border\b|\brights\b|\bequality\b/i, "justice"],
  [/\bsurvival\b|\bapocalyp|\bpost.apocalyp|\bendurance/i, "survival"],
  [/\btransform|\bmetamorph|\breinvent|\bbecoming/i, "transformation"],
  [/\bfaith\b|\bdoubt\b|\breligio|\bspiritual|\bbelief/i, "faith and doubt"],
  [/\bcreativi|\bartist|\bimagin|\binspiration|\binvent/i, "creativity"],
];

/**
 * Map Open Library subject strings to our 15 subject categories.
 * Returns unique matched category names.
 */
export function mapToSubjects(olSubjects: string[]): string[] {
  const matched = new Set<string>();
  const joined = olSubjects.join(" | ");

  for (const [pattern, category] of SUBJECT_KEYWORDS) {
    if (pattern.test(joined)) {
      matched.add(category);
    }
  }

  // If nothing matched but "fiction" is in there, default to Fiction
  if (matched.size === 0) {
    const hasFiction = olSubjects.some((s) => /fiction/i.test(s));
    if (hasFiction) matched.add("Fiction");
  }

  return [...matched];
}

/**
 * Map Open Library subject strings to our 20 theme categories.
 * Returns unique matched theme names (lowercase, matching DB).
 */
export function mapToThemes(olSubjects: string[]): string[] {
  const matched = new Set<string>();
  const joined = olSubjects.join(" | ");

  for (const [pattern, theme] of THEME_KEYWORDS) {
    if (pattern.test(joined)) {
      matched.add(theme);
    }
  }

  return [...matched];
}

// --- API calls ---

const OL_BASE = "https://openlibrary.org";
const COVERS_BASE = "https://covers.openlibrary.org";

/**
 * Search Open Library by title, author, or general query.
 */
export async function searchBooks(
  query: string,
  limit = 10
): Promise<OLSearchResult[]> {
  const url = `${OL_BASE}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=title,author_name,isbn,first_publish_year,publisher,number_of_pages_median,subject,key,cover_i`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];

  const data = await res.json();
  const docs = data.docs ?? [];

  return docs.map((doc: Record<string, unknown>): OLSearchResult => {
    const isbn = ((doc.isbn as string[]) ?? [])[0] ?? null;
    const coverId = doc.cover_i as number | undefined;

    return {
      title: (doc.title as string) ?? "Unknown",
      author: ((doc.author_name as string[]) ?? [])[0] ?? "Unknown",
      isbn,
      coverUrl: coverId
        ? `${COVERS_BASE}/b/id/${coverId}-M.jpg`
        : isbn
          ? `${COVERS_BASE}/b/isbn/${isbn}-M.jpg`
          : null,
      publishedYear: (doc.first_publish_year as number) ?? null,
      publisher: ((doc.publisher as string[]) ?? [])[0] ?? null,
      pageCount: (doc.number_of_pages_median as number) ?? null,
      subjects: (doc.subject as string[]) ?? [],
      olKey: (doc.key as string) ?? null,
    };
  });
}

/**
 * Look up a book by ISBN. Returns enriched result or null.
 */
export async function lookupISBN(isbn: string): Promise<OLBookDetail | null> {
  // Step 1: ISBN → edition → work key
  const editionRes = await fetch(`${OL_BASE}/isbn/${isbn}.json`);
  if (!editionRes.ok) return null;

  const edition = await editionRes.json();
  const title = edition.title ?? "Unknown";
  const publishers = edition.publishers ?? [];
  const pageCount = edition.number_of_pages ?? null;
  const publishedYear = edition.publish_date
    ? parseInt(edition.publish_date.match(/\d{4}/)?.[0] ?? "", 10) || null
    : null;

  // Step 2: Get work for subjects + description
  let subjects: string[] = [];
  let description: string | null = null;
  const workKeys = edition.works ?? [];
  if (workKeys.length > 0) {
    const workKey = workKeys[0].key;
    const workRes = await fetch(`${OL_BASE}${workKey}.json`);
    if (workRes.ok) {
      const work = await workRes.json();
      subjects = work.subjects ?? [];
      const desc = work.description;
      description = typeof desc === "string" ? desc : desc?.value ?? null;
    }
  }

  // Step 3: Get author
  let author = "Unknown";
  const authorKeys = edition.authors ?? [];
  if (authorKeys.length > 0) {
    const authorRes = await fetch(`${OL_BASE}${authorKeys[0].key}.json`);
    if (authorRes.ok) {
      const authorData = await authorRes.json();
      author = authorData.name ?? "Unknown";
    }
  }

  return {
    title,
    author,
    isbn,
    coverUrl: `${COVERS_BASE}/b/isbn/${isbn}-M.jpg`,
    publishedYear,
    publisher: publishers[0] ?? null,
    pageCount,
    subjects,
    olKey: workKeys[0]?.key ?? null,
    description,
  };
}

/**
 * Fuzzy match a title+author against Open Library.
 * Returns the best match or null.
 */
export async function fuzzyMatch(
  title: string,
  author: string
): Promise<OLSearchResult | null> {
  const results = await searchBooks(`${title} ${author}`, 5);
  if (results.length === 0) return null;

  // Simple scoring: prefer results where title and author closely match
  const titleLower = title.toLowerCase();
  const authorLower = author.toLowerCase();

  let best = results[0];
  let bestScore = 0;

  for (const r of results) {
    let score = 0;
    if (r.title.toLowerCase().includes(titleLower)) score += 3;
    else if (titleLower.includes(r.title.toLowerCase())) score += 2;
    if (r.author.toLowerCase().includes(authorLower)) score += 2;
    else if (authorLower.includes(r.author.toLowerCase())) score += 1;
    if (r.isbn) score += 1;
    if (r.coverUrl) score += 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return best;
}
