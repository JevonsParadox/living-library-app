/**
 * Nebula Block 2, Step 2: Build the SFF seed CSV
 *
 * Pipeline:
 * 1. Parse goodbooks-10k books.csv + book_tags.csv + tags.csv
 * 2. Filter to sci-fi/fantasy by tags
 * 3. Merge with extended data (descriptions, pages, genres)
 * 4. Normalize series from title patterns
 * 5. Compute popularity_score (0-100)
 * 6. Map to canonical_genre
 * 7. Export as sff_seed_5000.csv
 *
 * Usage: npx tsx scripts/nebula/build-seed-csv.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const RAW_DIR = resolve(__dirname, "../../data/nebula/raw");
const OUT_DIR = resolve(__dirname, "../../data/nebula");

// --- CSV parser (handles quoted fields with commas) ---

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// --- SFF tag filter ---

const SFF_TAGS = new Set([
  "science-fiction", "sci-fi", "fantasy", "scifi", "science_fiction",
  "epic-fantasy", "urban-fantasy", "dystopian", "cyberpunk", "space-opera",
  "high-fantasy", "dark-fantasy", "steampunk", "post-apocalyptic",
  "paranormal", "supernatural", "magic", "dragons", "aliens", "time-travel",
  "grimdark", "dystopia", "apocalyptic", "vampires", "werewolves",
  "fairy-tales", "mythology", "sword-and-sorcery", "space",
  "science-fiction-fantasy", "speculative-fiction", "alternate-history",
  "military-science-fiction", "hard-science-fiction",
]);

// --- Subgenre classification ---

function classifyGenre(tags: string[]): string {
  const t = new Set(tags.map((s) => s.toLowerCase()));

  // Sci-fi subgenres
  if (t.has("space-opera") || t.has("space")) return "sci-fi:space_opera";
  if (t.has("cyberpunk")) return "sci-fi:cyberpunk";
  if (t.has("dystopian") || t.has("dystopia")) return "sci-fi:dystopian";
  if (t.has("hard-science-fiction")) return "sci-fi:hard_sf";
  if (t.has("military-science-fiction")) return "sci-fi:military";
  if (t.has("steampunk")) return "sci-fi:cyberpunk"; // close enough
  if (t.has("alternate-history")) return "sci-fi:dystopian";
  if (t.has("aliens") || t.has("science-fiction") || t.has("sci-fi") || t.has("scifi") || t.has("science_fiction")) {
    // Generic sci-fi — try to narrow
    if (t.has("robots") || t.has("artificial-intelligence")) return "sci-fi:hard_sf";
    if (t.has("time-travel")) return "sci-fi:hard_sf";
    return "sci-fi:space_opera"; // default sci-fi
  }

  // Fantasy subgenres
  if (t.has("grimdark") || t.has("dark-fantasy")) return "fantasy:grimdark";
  if (t.has("urban-fantasy") || t.has("paranormal")) return "fantasy:urban";
  if (t.has("epic-fantasy") || t.has("high-fantasy")) return "fantasy:epic";
  if (t.has("sword-and-sorcery")) return "fantasy:sword_and_sorcery";
  if (t.has("mythology") || t.has("fairy-tales")) return "fantasy:mythic";
  if (t.has("vampires") || t.has("werewolves") || t.has("supernatural")) return "fantasy:urban";
  if (t.has("dragons")) return "fantasy:epic";
  if (t.has("magic")) return "fantasy:epic";
  if (t.has("fantasy")) return "fantasy:epic"; // default fantasy

  return "sci-fi:space_opera"; // ultimate fallback
}

// --- Series extraction ---

function extractSeries(title: string): { cleanTitle: string; seriesName: string | null; seriesOrder: number | null; seriesId: string | null } {
  // Match patterns like "Title (Series Name, #3)" or "Title (Series, Book 3)"
  const match = title.match(/^(.+?)\s*\(([^)]+),\s*#?(\d+(?:\.\d+)?)\)\s*$/);
  if (match) {
    const seriesName = match[2].trim();
    const seriesId = seriesName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      cleanTitle: match[1].trim(),
      seriesName,
      seriesOrder: parseFloat(match[3]),
      seriesId,
    };
  }

  // Match "Title (Series Name #3)" without comma
  const match2 = title.match(/^(.+?)\s*\(([^)]+?)\s+#(\d+(?:\.\d+)?)\)\s*$/);
  if (match2) {
    const seriesName = match2[2].trim();
    const seriesId = seriesName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      cleanTitle: match2[1].trim(),
      seriesName,
      seriesOrder: parseFloat(match2[3]),
      seriesId,
    };
  }

  return { cleanTitle: title, seriesName: null, seriesOrder: null, seriesId: null };
}

// --- Escape CSV field ---

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

// --- Main ---

function build() {
  console.log("Loading raw data...");

  const booksRaw = parseCSV(readFileSync(resolve(RAW_DIR, "books.csv"), "utf-8"));
  const bookTagsRaw = parseCSV(readFileSync(resolve(RAW_DIR, "book_tags.csv"), "utf-8"));
  const tagsRaw = parseCSV(readFileSync(resolve(RAW_DIR, "tags.csv"), "utf-8"));
  const enrichedRaw = parseCSV(readFileSync(resolve(RAW_DIR, "books_enriched.csv"), "utf-8"));

  console.log(`  books.csv: ${booksRaw.length} rows`);
  console.log(`  book_tags.csv: ${bookTagsRaw.length} rows`);
  console.log(`  tags.csv: ${tagsRaw.length} rows`);
  console.log(`  books_enriched.csv: ${enrichedRaw.length} rows`);

  // Build tag name lookup
  const tagNameMap = new Map<string, string>();
  for (const t of tagsRaw) {
    tagNameMap.set(t.tag_id, t.tag_name);
  }

  // Build tag map per goodreads_book_id
  const bookTagMap = new Map<string, { name: string; count: number }[]>();
  for (const bt of bookTagsRaw) {
    const tagName = tagNameMap.get(bt.tag_id);
    if (!tagName) continue;
    const grId = bt.goodreads_book_id;
    const existing = bookTagMap.get(grId) ?? [];
    existing.push({ name: tagName, count: parseInt(bt.count) || 0 });
    bookTagMap.set(grId, existing);
  }

  // Build enriched lookup by book_id
  const enrichedMap = new Map<string, Record<string, string>>();
  for (const e of enrichedRaw) {
    enrichedMap.set(e.book_id, e);
  }

  // Filter to SFF
  console.log("\nFiltering to sci-fi/fantasy...");
  const sffBooks: typeof booksRaw = [];

  for (const book of booksRaw) {
    const grId = book.goodreads_book_id;
    const tags = bookTagMap.get(grId) ?? [];
    const tagNames = tags.map((t) => t.name.toLowerCase());
    const isSFF = tagNames.some((t) => SFF_TAGS.has(t));
    if (isSFF) sffBooks.push(book);
  }

  console.log(`  SFF books found: ${sffBooks.length}`);

  // Compute popularity scores
  const ratingsCounts = sffBooks.map((b) => parseInt(b.ratings_count) || 0);
  const logCounts = ratingsCounts.map((c) => Math.log1p(c));
  const minLog = Math.min(...logCounts);
  const maxLog = Math.max(...logCounts);
  const logRange = maxLog - minLog || 1;

  // Build output rows
  const outputRows: string[][] = [];
  const HEADER = "canonical_title,primary_author,series_name,series_order,publication_year,description,isbn_10,isbn_13,cover_url,page_count,language,canonical_genre,popularity_score,tags,tropes,source_list,series_id";

  for (let i = 0; i < sffBooks.length; i++) {
    const book = sffBooks[i];
    const enriched = enrichedMap.get(book.book_id);
    const grId = book.goodreads_book_id;
    const tags = bookTagMap.get(grId) ?? [];
    const tagNames = tags
      .sort((a, b) => b.count - a.count)
      .map((t) => t.name.toLowerCase())
      .slice(0, 15);

    // Series extraction
    const { cleanTitle, seriesName, seriesOrder, seriesId } = extractSeries(book.title);

    // Description from enriched
    const description = enriched?.description?.replace(/\n/g, " ").trim() ?? "";

    // Page count from enriched — strip trailing .0
    const pageCount = (enriched?.pages || "").replace(/\.0$/, "");

    // Publication year — strip trailing .0
    const rawYear = book.original_publication_year || enriched?.publishDate?.match(/\d{4}/)?.[0] || "";
    const pubYear = rawYear.replace(/\.0$/, "");

    // ISBNs — fix scientific notation (9.78043902348e+12 → 9780439023480)
    let isbn13 = book.isbn13 || "";
    if (isbn13.includes("e+") || isbn13.includes("E+")) {
      isbn13 = Math.round(parseFloat(isbn13)).toString();
    }
    isbn13 = isbn13.replace(/\.0$/, "");
    const isbn10 = book.isbn || "";

    // Cover URL — prefer Open Library via ISBN, fallback to Goodreads
    let coverUrl = "";
    if (isbn13) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg`;
    } else if (book.image_url && !book.image_url.includes("nophoto")) {
      coverUrl = book.image_url;
    }

    // Language
    const language = book.language_code || "en";

    // Genre classification
    const sffTags = tagNames.filter((t) => SFF_TAGS.has(t));
    const canonicalGenre = classifyGenre(sffTags.length > 0 ? sffTags : tagNames);

    // Popularity score (0-100)
    const popScore = ((logCounts[i] - minLog) / logRange * 100).toFixed(2);

    // Tags (top 10 non-genre tags)
    const contentTags = tagNames
      .filter((t) => !SFF_TAGS.has(t) && t !== "to-read" && t !== "currently-reading" && t !== "favorites" && t !== "owned" && t !== "books-i-own")
      .slice(0, 10)
      .join(",");

    // Author (primary)
    const author = book.authors?.split(",")[0]?.trim() ?? "";

    outputRows.push([
      csvEscape(cleanTitle),
      csvEscape(author),
      csvEscape(seriesName ?? ""),
      seriesOrder?.toString() ?? "",
      pubYear,
      csvEscape(description.slice(0, 500)),
      isbn10,
      isbn13,
      coverUrl,
      pageCount,
      language,
      canonicalGenre,
      popScore,
      csvEscape(contentTags),
      "", // tropes — could be derived from tags later
      "Goodreads (goodbooks-10k)",
      seriesId ?? "",
    ]);
  }

  // Sort by popularity descending, take top 5000
  outputRows.sort((a, b) => parseFloat(b[12]) - parseFloat(a[12]));
  const finalRows = outputRows.slice(0, 5000);

  // Write CSV
  const csvContent = HEADER + "\n" + finalRows.map((r) => r.join(",")).join("\n") + "\n";
  const outPath = resolve(OUT_DIR, "sff_seed_5000.csv");
  writeFileSync(outPath, csvContent, "utf-8");

  console.log(`\nExported ${finalRows.length} rows to data/nebula/sff_seed_5000.csv`);

  // Stats
  const genreCounts: Record<string, number> = {};
  for (const row of finalRows) {
    const genre = row[11];
    genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
  }
  console.log("\nGenre distribution:");
  Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([genre, count]) => console.log(`  ${genre}: ${count}`));

  const withSeries = finalRows.filter((r) => r[2]).length;
  const withDesc = finalRows.filter((r) => r[5]).length;
  const withCover = finalRows.filter((r) => r[8]).length;
  const withPages = finalRows.filter((r) => r[9]).length;
  console.log(`\nCoverage:`);
  console.log(`  With series: ${withSeries}`);
  console.log(`  With description: ${withDesc}`);
  console.log(`  With cover URL: ${withCover}`);
  console.log(`  With page count: ${withPages}`);
}

build();
