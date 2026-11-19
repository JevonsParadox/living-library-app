/**
 * 03 — Extract ISFDB candidates, score, classify, select top 10k, write JSONL.
 *
 * Inputs:
 *   - Running local MySQL with ISFDB dump restored (from 02-load-mysql.ts)
 *   - data/nebula/raw/books.csv (goodbooks-10k) for popularity signal
 *
 * Output:
 *   data/nebula/seed-top-10k.jsonl
 *
 * Usage: npx tsx scripts/nebula/seed-top-10k/03-extract-and-select.ts
 */

import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";
import { config } from "dotenv";

import type { IsfdbCandidate, Award, ScoredCandidate } from "./shared/types";
import { deriveNormalisationBounds, score } from "./shared/scoring";
import { classifyGenre } from "./shared/genre-classify";
import { selectTopN } from "./shared/selection";
import { isCanon } from "./shared/canon-list";

config({ path: resolve(__dirname, "../../../.env.local") });

const MYSQL_CONFIG = {
  host: "127.0.0.1",
  port: 3307,
  user: "root",
  password: "local",
  database: "isfdb",
};

const OUTPUT_PATH = resolve(__dirname, "../../../data/nebula/seed-top-10k.jsonl");
const GOODBOOKS_CSV = resolve(__dirname, "../../../data/nebula/raw/books.csv");

// ISFDB title types we keep.
const ALLOWED_TYPES = ["NOVEL", "COLLECTION", "OMNIBUS", "ANTHOLOGY", "CHAPBOOK", "NONFICTION"];

async function extractCandidates(conn: Connection): Promise<Map<number, IsfdbCandidate>> {
  console.log("building candidate set (titles with English ISBN'd editions)...");

  await conn.query("DROP TEMPORARY TABLE IF EXISTS cand_titles");
  await conn.query(`
    CREATE TEMPORARY TABLE cand_titles (
      title_id INT PRIMARY KEY
    ) ENGINE=MEMORY
  `);

  await conn.query(`
    INSERT INTO cand_titles (title_id)
    SELECT DISTINCT t.title_id
      FROM titles t
      JOIN pub_content pc ON pc.title_id = t.title_id
      JOIN pubs p ON p.pub_id = pc.pub_id
     WHERE t.title_ttype IN (${ALLOWED_TYPES.map((x) => `'${x}'`).join(",")})
       AND t.title_language = 17
       AND t.title_parent = 0
       AND t.title_non_genre = 'No'
       AND p.pub_isbn IS NOT NULL
       AND p.pub_isbn != ''
  `);

  const [countRow] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM cand_titles",
  );
  const count = Number(countRow[0]?.n ?? 0);
  console.log(`  ${count} candidates`);

  // Main titles + canonical author + series.
  console.log("loading titles...");
  const [titleRows] = await conn.query<RowDataPacket[]>(`
    SELECT
      t.title_id,
      t.title_title AS title,
      t.title_synopsis AS synopsis,
      COALESCE(YEAR(t.title_copyright), NULL) AS pub_year,
      t.title_ttype,
      t.title_seriesnum,
      t.series_id,
      s.series_title,
      ca.author_id AS canonical_author_id,
      a.author_canonical AS canonical_author_name,
      (CASE WHEN ca.ca_status = 2 THEN 1 ELSE 0 END) AS translated
    FROM cand_titles ct
    JOIN titles t ON t.title_id = ct.title_id
    LEFT JOIN canonical_author ca ON ca.title_id = t.title_id
    LEFT JOIN authors a ON a.author_id = ca.author_id
    LEFT JOIN series s ON s.series_id = t.series_id
  `);

  const candidates = new Map<number, IsfdbCandidate>();
  for (const row of titleRows as Record<string, unknown>[]) {
    const id = Number(row.title_id);
    candidates.set(id, {
      title_id: id,
      title: String(row.title ?? ""),
      title_synopsis: (row.synopsis as string) ?? null,
      publication_year: row.pub_year ? Number(row.pub_year) : null,
      title_ttype: String(row.title_ttype ?? ""),
      canonical_author_id: row.canonical_author_id ? Number(row.canonical_author_id) : null,
      canonical_author_name: (row.canonical_author_name as string) ?? null,
      series_id: row.series_id ? Number(row.series_id) : null,
      series_title: (row.series_title as string) ?? null,
      series_order: row.title_seriesnum ? Number(row.title_seriesnum) : null,
      canonical_pub_id: null,
      isbn_13: null,
      isbn_10: null,
      page_count: null,
      publisher: null,
      cover_path: null,
      tags: [],
      awards: [],
      edition_count: 0,
      translated: row.translated === 1 || row.translated === "1",
    });
  }

  // Tags.
  console.log("loading tags...");
  const [tagRows] = await conn.query<RowDataPacket[]>(`
    SELECT tt.title_id, tg.tag_name
      FROM cand_titles ct
      JOIN tag_mapping tt ON tt.title_id = ct.title_id
      JOIN tags tg ON tg.tag_id = tt.tag_id
  `);
  for (const row of tagRows as Record<string, unknown>[]) {
    const c = candidates.get(Number(row.title_id));
    if (c && typeof row.tag_name === "string") c.tags.push(row.tag_name);
  }
  console.log(`  ${tagRows.length} tag rows`);

  // Awards. Table is title_awards (not award_titles); award_year is a DATE.
  console.log("loading awards...");
  const [awardRows] = await conn.query<RowDataPacket[]>(`
    SELECT
      ta.title_id,
      aw.award_title AS award_name,
      aw.award_cat_id,
      YEAR(aw.award_year) AS award_year,
      aw.award_level
    FROM cand_titles ct
    JOIN title_awards ta ON ta.title_id = ct.title_id
    JOIN awards aw ON aw.award_id = ta.award_id
  `);
  for (const row of awardRows as Record<string, unknown>[]) {
    const c = candidates.get(Number(row.title_id));
    if (!c) continue;
    // ISFDB stores award_level as a numeric string; "1" = winner, > 1 = finalist/nominee variants.
    const result: Award["result"] = String(row.award_level ?? "").trim() === "1" ? "won" : "nominee";
    c.awards.push({
      name: String(row.award_name ?? ""),
      category: null,
      year: row.award_year ? Number(row.award_year) : null,
      result,
    });
  }
  console.log(`  ${awardRows.length} award rows`);

  // Edition count + canonical pub (prefer recent English ISBN-13 with page count).
  console.log("loading editions...");
  const [pubRows] = await conn.query<RowDataPacket[]>(`
    SELECT
      pc.title_id,
      p.pub_id,
      p.pub_isbn,
      p.pub_year,
      p.pub_pages,
      p.pub_ctype,
      pu.publisher_name
    FROM cand_titles ct
    JOIN pub_content pc ON pc.title_id = ct.title_id
    JOIN pubs p ON p.pub_id = pc.pub_id
    LEFT JOIN publishers pu ON pu.publisher_id = p.publisher_id
    WHERE p.pub_isbn IS NOT NULL AND p.pub_isbn != ''
  `);
  const pubCountByTitle = new Map<number, number>();
  const bestPubByTitle = new Map<number, Record<string, unknown>>();
  for (const row of pubRows as Record<string, unknown>[]) {
    const tid = Number(row.title_id);
    pubCountByTitle.set(tid, (pubCountByTitle.get(tid) ?? 0) + 1);

    const rawIsbn = String(row.pub_isbn ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
    if (rawIsbn.length !== 13 && rawIsbn.length !== 10) continue;

    const current = bestPubByTitle.get(tid);
    if (!current) {
      bestPubByTitle.set(tid, row);
      continue;
    }
    // Prefer ISBN-13 over 10, then larger pub_year, then larger pub_pages.
    const currentIsbnLen = String(current.pub_isbn ?? "").replace(/[^0-9X]/gi, "").length;
    const candidateIsbnLen = rawIsbn.length;
    if (candidateIsbnLen > currentIsbnLen) {
      bestPubByTitle.set(tid, row);
      continue;
    }
    if (candidateIsbnLen === currentIsbnLen) {
      const currentYear = Number(current.pub_year ?? 0);
      const candidateYear = Number(row.pub_year ?? 0);
      if (candidateYear > currentYear) bestPubByTitle.set(tid, row);
    }
  }
  for (const [tid, c] of candidates) {
    c.edition_count = pubCountByTitle.get(tid) ?? 0;
    const best = bestPubByTitle.get(tid);
    if (best) {
      c.canonical_pub_id = best.pub_id ? Number(best.pub_id) : null;
      const isbn = String(best.pub_isbn ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
      if (isbn.length === 13) c.isbn_13 = isbn;
      else if (isbn.length === 10) c.isbn_10 = isbn;
      c.page_count = best.pub_pages ? Number(best.pub_pages) : null;
      c.publisher = (best.publisher_name as string) ?? null;
    }
  }
  console.log(`  ${pubRows.length} pub rows; ${bestPubByTitle.size} candidates have a best pub`);

  // Drop candidates without any valid ISBN (should be rare since we filtered pubs.pub_isbn != '').
  for (const [tid, c] of candidates) {
    if (!c.isbn_13 && !c.isbn_10) candidates.delete(tid);
  }

  return candidates;
}

async function loadGoodbooks(): Promise<Map<string, number>> {
  const byIsbn13 = new Map<string, number>();
  if (!existsSync(GOODBOOKS_CSV)) {
    console.log("goodbooks-10k CSV not present; skipping popularity signal");
    return byIsbn13;
  }
  const rl = createInterface({ input: createReadStream(GOODBOOKS_CSV) });
  let headerIdx: Record<string, number> = {};
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    const cols = parseCsvLine(line);
    if (lineNo === 1) {
      cols.forEach((h, i) => { headerIdx[h] = i; });
      continue;
    }
    const isbn13 = (cols[headerIdx.isbn13] ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
    const ratings = Number(cols[headerIdx.ratings_count] ?? 0);
    if (isbn13 && ratings > 0) byIsbn13.set(isbn13, ratings);
  }
  return byIsbn13;
}

/**
 * Minimal CSV parser — good enough for goodbooks-10k's quoted-string columns.
 * Not production-grade; doesn't handle escaped quotes inside quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  const conn = await createConnection(MYSQL_CONFIG);
  try {
    const candidates = await extractCandidates(conn);
    console.log(`extracted ${candidates.size} candidates`);

    const goodbooks = await loadGoodbooks();
    console.log(`goodbooks-10k: ${goodbooks.size} ISBN-13 popularity rows`);

    const arr = Array.from(candidates.values());
    const bounds = deriveNormalisationBounds(arr);
    // Goodreads max from the join
    let goodreadsLog1pMax = 0;
    for (const c of arr) {
      const isbn = c.isbn_13 ?? c.isbn_10;
      const gr = isbn ? goodbooks.get(isbn) ?? null : null;
      if (gr) goodreadsLog1pMax = Math.max(goodreadsLog1pMax, Math.log1p(gr));
    }
    bounds.goodreadsLog1pMax = goodreadsLog1pMax;
    console.log(`bounds: awards=${bounds.awardsLog1pMax.toFixed(2)} editions=${bounds.editionsLog1pP99.toFixed(2)} goodreads=${bounds.goodreadsLog1pMax.toFixed(2)}`);

    // Score + classify.
    console.log("scoring + classifying...");
    const scored: ScoredCandidate[] = arr.map((c) => {
      const isbn = c.isbn_13 ?? c.isbn_10;
      const gr = isbn ? goodbooks.get(isbn) ?? null : null;
      const s = score({ candidate: c, goodreadsRatingsCount: gr, isCanon: isCanon(c.title, c.canonical_author_name), bounds });
      const g = classifyGenre(c);
      s.canonical_genre = g.genre;
      s.sub_genre = g.sub_genre;
      return s;
    });

    // Drop unknown-genre candidates — we want only sff+horror in the seed.
    const classified = scored.filter((c) => c.canonical_genre !== "unknown");
    console.log(`post-classify: ${classified.length} (dropped ${scored.length - classified.length} unknown-genre)`);

    // Selection.
    console.log("selecting top 10k...");
    const result = selectTopN(classified);
    console.log(`selected: ${result.stats.selected}`);
    console.log(`  genre: horror=${result.stats.horror} sci-fi=${result.stats.scifi} fantasy=${result.stats.fantasy}`);
    console.log(`  floors met: ${JSON.stringify(result.stats.floorsMet)}`);
    console.log(`  pre-${new Date().getFullYear()} pre-2000=${result.stats.preYear}, translations=${result.stats.translation}, recent-award-winners=${result.stats.recentAwardWinners}`);

    // Write JSONL.
    console.log(`writing ${OUTPUT_PATH}`);
    const ws = createWriteStream(OUTPUT_PATH);
    for (const c of result.selected) {
      ws.write(JSON.stringify(c) + "\n");
    }
    await new Promise<void>((res) => ws.end(() => res()));
    console.log("done.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
