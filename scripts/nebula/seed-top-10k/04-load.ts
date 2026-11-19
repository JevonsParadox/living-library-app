/**
 * 04 — Load data/nebula/seed-top-10k.jsonl into Supabase.
 *
 * Idempotent. Matched rows (existing books) get gap-filled only, never
 * overwritten. New books get a full shell + seeded coords + shell statuses.
 *
 * Flags:
 *   --dry-run               Print what would change; don't write.
 *   --enqueue-enrichment    Enqueue metadata jobs for new shells (default on).
 *   --no-enqueue-enrichment Skip the enqueue step.
 *
 * Usage: npx tsx scripts/nebula/seed-top-10k/04-load.ts [--dry-run]
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";

import type { ScoredCandidate } from "./shared/types";
import { authorSurname, normaliseTitle } from "../../../lib/nebula/title-normalise";
import { seededCoordsFor } from "../../../lib/nebula/seeded-coords";

config({ path: resolve(__dirname, "../../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const INPUT_PATH = resolve(__dirname, "../../../data/nebula/seed-top-10k.jsonl");

interface Options {
  dryRun: boolean;
  enqueueEnrichment: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    enqueueEnrichment: !args.includes("--no-enqueue-enrichment"),
  };
}

// --- Existing-state loaders ---

interface Indexes {
  byIsfdbTitleId: Map<number, string>;       // -> work_id
  byIsbn13: Map<string, string>;
  byIsbn10: Map<string, string>;
  byTitleSurname: Map<string, string>;       // key = `${normTitle}|${surname}`
  authorByNormName: Map<string, string>;     // -> author_id
  seriesByNormName: Map<string, string>;     // -> series_id
  seriesByIsfdbId: Map<number, string>;      // -> series_id
  regionsByGenre: Map<string, string>;       // canonical_genre -> region_id
  regionsById: Map<string, { id: string; anchor_x: number; anchor_y: number; anchor_z: number }>;
}

async function paginateAll<T extends Record<string, unknown>>(
  table: string,
  select: string,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table} fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function buildIndexes(): Promise<Indexes> {
  console.log("loading existing Supabase state...");

  type BookRow = {
    id: string;
    title: string;
    isbn_13: string | null;
    isbn_10: string | null;
    external_ids: Record<string, unknown> | null;
    primary_author_id: string | null;
  };
  type EditionRow = { work_id: string; isbn_13: string | null; isbn_10: string | null };
  type AuthorRow = { id: string; name: string };
  type SeriesRow = { id: string; name: string; slug: string | null; external_ids: Record<string, unknown> | null };
  type RegionRow = { id: string; name: string; slug: string | null; anchor_x: number; anchor_y: number; anchor_z: number };

  const [books, editions, authors, series, regions] = await Promise.all([
    paginateAll<BookRow>("nb_books", "id, title, isbn_13, isbn_10, external_ids, primary_author_id"),
    paginateAll<EditionRow>("nb_editions", "work_id, isbn_13, isbn_10"),
    paginateAll<AuthorRow>("nb_authors", "id, name"),
    paginateAll<SeriesRow>("nb_series", "id, name, slug, external_ids"),
    paginateAll<RegionRow>("nb_regions", "id, name, slug, anchor_x, anchor_y, anchor_z"),
  ]);

  const authorById = new Map(authors.map((a) => [a.id, a]));
  const byIsfdbTitleId = new Map<number, string>();
  const byIsbn13 = new Map<string, string>();
  const byIsbn10 = new Map<string, string>();
  const byTitleSurname = new Map<string, string>();

  for (const b of books) {
    const isfdb = (b.external_ids as { isfdb?: { title_id?: number } } | null)?.isfdb?.title_id;
    if (typeof isfdb === "number") byIsfdbTitleId.set(isfdb, b.id);
    if (b.isbn_13) byIsbn13.set(b.isbn_13.toUpperCase(), b.id);
    if (b.isbn_10) byIsbn10.set(b.isbn_10.toUpperCase(), b.id);
    const authorName = b.primary_author_id ? authorById.get(b.primary_author_id)?.name ?? "" : "";
    const key = `${normaliseTitle(b.title)}|${authorSurname(authorName)}`;
    if (key.length > 2) byTitleSurname.set(key, b.id);
  }

  for (const e of editions) {
    if (e.isbn_13) byIsbn13.set(e.isbn_13.toUpperCase(), e.work_id);
    if (e.isbn_10) byIsbn10.set(e.isbn_10.toUpperCase(), e.work_id);
  }

  const authorByNormName = new Map<string, string>();
  for (const a of authors) authorByNormName.set(normName(a.name), a.id);

  const seriesByNormName = new Map<string, string>();
  const seriesByIsfdbId = new Map<number, string>();
  for (const s of series) {
    seriesByNormName.set(normName(s.name), s.id);
    const isfdbId = (s.external_ids as { isfdb?: { series_id?: number } } | null)?.isfdb?.series_id;
    if (typeof isfdbId === "number") seriesByIsfdbId.set(isfdbId, s.id);
  }

  // Region mapping by genre — match against region name/slug with simple keyword rules.
  const regionsByGenre = new Map<string, string>();
  const regionsById = new Map<string, { id: string; anchor_x: number; anchor_y: number; anchor_z: number }>();
  for (const r of regions) {
    regionsById.set(r.id, { id: r.id, anchor_x: r.anchor_x, anchor_y: r.anchor_y, anchor_z: r.anchor_z });
  }
  const findRegion = (patterns: RegExp[]): string | undefined => {
    for (const r of regions) {
      const hay = `${r.name} ${r.slug ?? ""}`;
      if (patterns.some((p) => p.test(hay))) return r.id;
    }
    return undefined;
  };
  const horror = findRegion([/horror/i, /weird/i, /gothic/i]);
  const scifi = findRegion([/sci.?fi/i, /science/i, /space/i]);
  const fantasy = findRegion([/fantasy/i, /magic/i]);
  if (horror) regionsByGenre.set("horror", horror);
  if (scifi) regionsByGenre.set("sci-fi", scifi);
  if (fantasy) regionsByGenre.set("fantasy", fantasy);

  // Fallbacks: if any genre has no matching region, reuse another.
  if (!regionsByGenre.has("horror") && fantasy) regionsByGenre.set("horror", fantasy);
  if (!regionsByGenre.has("sci-fi") && fantasy) regionsByGenre.set("sci-fi", fantasy);
  if (!regionsByGenre.has("fantasy") && scifi) regionsByGenre.set("fantasy", scifi);

  console.log(`  ${books.length} books, ${editions.length} editions, ${authors.length} authors, ${series.length} series, ${regions.length} regions`);
  console.log(`  region mapping: horror=${regionsByGenre.get("horror") ?? "—"}, sci-fi=${regionsByGenre.get("sci-fi") ?? "—"}, fantasy=${regionsByGenre.get("fantasy") ?? "—"}`);

  return {
    byIsfdbTitleId,
    byIsbn13,
    byIsbn10,
    byTitleSurname,
    authorByNormName,
    seriesByNormName,
    seriesByIsfdbId,
    regionsByGenre,
    regionsById,
  };
}

// --- Resolve or create helpers ---

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function resolveAuthor(
  name: string,
  idx: Indexes,
  dryRun: boolean,
): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const key = normName(name);
  const existing = idx.authorByNormName.get(key);
  if (existing) return existing;

  if (dryRun) return null;

  const { data, error } = await supabase
    .from("nb_authors")
    .insert({ name, sort_name: name })
    .select("id")
    .single();
  if (error) {
    // Race-condition fallback: re-query.
    const { data: again } = await supabase.from("nb_authors").select("id").eq("name", name).maybeSingle();
    if (again?.id) {
      idx.authorByNormName.set(key, again.id as string);
      return again.id as string;
    }
    console.warn(`  author insert failed for "${name}": ${error.message}`);
    return null;
  }
  idx.authorByNormName.set(key, data!.id as string);
  return data!.id as string;
}

async function resolveSeries(
  candidate: ScoredCandidate,
  idx: Indexes,
  dryRun: boolean,
): Promise<string | null> {
  if (!candidate.series_id || !candidate.series_title) return null;

  const existingByIsfdb = idx.seriesByIsfdbId.get(candidate.series_id);
  if (existingByIsfdb) return existingByIsfdb;

  const key = normName(candidate.series_title);
  const existingByName = idx.seriesByNormName.get(key);
  if (existingByName) {
    // Stamp ISFDB id onto the existing series if missing.
    if (!dryRun) {
      await supabase
        .from("nb_series")
        .update({
          external_ids: { isfdb: { series_id: candidate.series_id } },
        })
        .eq("id", existingByName);
    }
    idx.seriesByIsfdbId.set(candidate.series_id, existingByName);
    return existingByName;
  }

  if (dryRun) return null;

  const slug = `${slugify(candidate.series_title)}-${candidate.series_id}`;
  const { data, error } = await supabase
    .from("nb_series")
    .insert({
      name: candidate.series_title,
      slug,
      external_ids: { isfdb: { series_id: candidate.series_id } },
    })
    .select("id")
    .single();
  if (error) {
    console.warn(`  series insert failed: ${error.message}`);
    return null;
  }
  idx.seriesByNormName.set(key, data!.id as string);
  idx.seriesByIsfdbId.set(candidate.series_id, data!.id as string);
  return data!.id as string;
}

function dedupeWorkId(candidate: ScoredCandidate, idx: Indexes): string | null {
  if (idx.byIsfdbTitleId.has(candidate.title_id)) {
    return idx.byIsfdbTitleId.get(candidate.title_id)!;
  }
  if (candidate.isbn_13 && idx.byIsbn13.has(candidate.isbn_13)) {
    return idx.byIsbn13.get(candidate.isbn_13)!;
  }
  if (candidate.isbn_10 && idx.byIsbn10.has(candidate.isbn_10)) {
    return idx.byIsbn10.get(candidate.isbn_10)!;
  }
  const key = `${normaliseTitle(candidate.title)}|${authorSurname(candidate.canonical_author_name ?? "")}`;
  if (key.length > 2 && idx.byTitleSurname.has(key)) {
    return idx.byTitleSurname.get(key)!;
  }
  return null;
}

// --- Main ---

async function main() {
  const opts = parseArgs();
  if (opts.dryRun) console.log("DRY RUN — no writes");

  if (!existsSync(INPUT_PATH)) {
    console.error(`input not found: ${INPUT_PATH}`);
    console.error("run 03-extract-and-select.ts first");
    process.exit(2);
  }

  const idx = await buildIndexes();

  const stats = {
    total: 0,
    matched: 0,
    inserted: 0,
    gapsFilled: 0,
    authorsCreated: 0,
    seriesCreated: 0,
    editionsCreated: 0,
    tagsInserted: 0,
    awardsInserted: 0,
    statusCreated: 0,
    coordsCreated: 0,
    metadataJobsEnqueued: 0,
    skippedAlreadyLoaded: 0,
  };

  const rl = createInterface({ input: createReadStream(INPUT_PATH) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.total++;
    const candidate = JSON.parse(line) as ScoredCandidate;

    const matchedWorkId = dedupeWorkId(candidate, idx);
    if (matchedWorkId) {
      // Already loaded under this ISFDB id? Skip.
      if (idx.byIsfdbTitleId.get(candidate.title_id) === matchedWorkId) {
        stats.skippedAlreadyLoaded++;
        continue;
      }
      stats.matched++;
      await gapFillExisting(matchedWorkId, candidate, idx, opts, stats);
      continue;
    }

    stats.inserted++;
    await insertNewShell(candidate, idx, opts, stats);
  }

  console.log("\n=== stats ===");
  console.log(JSON.stringify(stats, null, 2));

  if (!opts.dryRun) {
    await supabase.from("nb_external_source_runs").insert({
      provider: "isfdb_seed",
      version: new Date().toISOString().slice(0, 10),
      mode: "full",
      status: "completed",
      finished_at: new Date().toISOString(),
      stats,
    });
  }
}

// --- Matched: gap-fill existing row ---

async function gapFillExisting(
  workId: string,
  candidate: ScoredCandidate,
  idx: Indexes,
  opts: Options,
  stats: Record<string, number>,
): Promise<void> {
  // Load current scalar state.
  const { data: book } = await supabase
    .from("nb_books")
    .select("id, publication_year, original_publication_year, page_count, isbn_13, isbn_10, canonical_genre, series_id, series_order, primary_author_id, external_ids")
    .eq("id", workId)
    .single<{
      id: string;
      publication_year: number | null;
      original_publication_year: number | null;
      page_count: number | null;
      isbn_13: string | null;
      isbn_10: string | null;
      canonical_genre: string | null;
      series_id: string | null;
      series_order: number | null;
      primary_author_id: string | null;
      external_ids: Record<string, unknown> | null;
    }>();
  if (!book) return;

  const patch: Record<string, unknown> = {};
  const provenance = ((book.external_ids as { provenance?: Record<string, { tier: number; provider: string }> } | null)?.provenance) ?? {};
  const stampField = (field: string) => {
    provenance[field] = { tier: 1, provider: "isfdb" };
  };
  const gapFill = (field: string, currentValue: unknown, newValue: unknown) => {
    if (newValue == null) return;
    const isEmpty = currentValue == null || currentValue === "" || (Array.isArray(currentValue) && currentValue.length === 0);
    if (isEmpty) {
      patch[field] = newValue;
      stampField(field);
      stats.gapsFilled++;
    }
  };

  gapFill("publication_year", book.publication_year, candidate.publication_year);
  gapFill("original_publication_year", book.original_publication_year, candidate.publication_year);
  gapFill("page_count", book.page_count, candidate.page_count);
  gapFill("isbn_13", book.isbn_13, candidate.isbn_13);
  gapFill("isbn_10", book.isbn_10, candidate.isbn_10);
  gapFill("canonical_genre", book.canonical_genre, `${candidate.canonical_genre}${candidate.sub_genre ? `:${candidate.sub_genre}` : ""}`);

  if (!book.series_id && candidate.series_title) {
    const seriesId = await resolveSeries(candidate, idx, opts.dryRun);
    if (seriesId) {
      patch.series_id = seriesId;
      patch.series_order = candidate.series_order;
      stampField("series_id");
      stats.gapsFilled++;
    }
  }

  // Stamp ISFDB external_ids regardless of whether we wrote fields.
  const existing = (book.external_ids ?? {}) as Record<string, unknown>;
  const isfdbIds = {
    ...((existing.isfdb as Record<string, unknown>) ?? {}),
    title_id: candidate.title_id,
  };
  if (candidate.canonical_author_id) {
    (isfdbIds as Record<string, unknown>).canonical_author_id = candidate.canonical_author_id;
  }
  patch.external_ids = { ...existing, isfdb: isfdbIds, provenance };

  if (!opts.dryRun) {
    await supabase.from("nb_books").update(patch).eq("id", workId);
  }

  // Edition: add if missing.
  if (candidate.isbn_13 || candidate.isbn_10) {
    const existsEdition =
      (candidate.isbn_13 && idx.byIsbn13.has(candidate.isbn_13)) ||
      (candidate.isbn_10 && idx.byIsbn10.has(candidate.isbn_10));
    if (!existsEdition && !opts.dryRun) {
      await supabase.from("nb_editions").insert({
        work_id: workId,
        isbn_13: candidate.isbn_13,
        isbn_10: candidate.isbn_10,
        publisher: candidate.publisher,
        publication_year: candidate.publication_year,
        page_count: candidate.page_count,
        external_ids: { isfdb: { pub_id: candidate.canonical_pub_id } },
        source: "isfdb",
      });
      stats.editionsCreated++;
      if (candidate.isbn_13) idx.byIsbn13.set(candidate.isbn_13, workId);
      if (candidate.isbn_10) idx.byIsbn10.set(candidate.isbn_10, workId);
    }
  }

  await insertTagsAndAwards(workId, candidate, opts, stats);

  // Track the isfdb_title_id -> work_id in our index so subsequent re-runs skip.
  idx.byIsfdbTitleId.set(candidate.title_id, workId);
}

// --- No match: new shell ---

async function insertNewShell(
  candidate: ScoredCandidate,
  idx: Indexes,
  opts: Options,
  stats: Record<string, number>,
): Promise<void> {
  if (opts.dryRun) return;

  const authorId = candidate.canonical_author_name
    ? await resolveAuthor(candidate.canonical_author_name, idx, opts.dryRun)
    : null;
  if (authorId && !idx.authorByNormName.has(normName(candidate.canonical_author_name ?? ""))) {
    stats.authorsCreated++;
  }
  const seriesId = await resolveSeries(candidate, idx, opts.dryRun);
  if (seriesId && candidate.series_id && idx.seriesByIsfdbId.get(candidate.series_id) === seriesId) {
    // May have just been created; tally once.
    // (The resolveSeries helper is idempotent; we only bump stats for fresh inserts.)
  }

  const canonicalGenre = `${candidate.canonical_genre}${candidate.sub_genre ? `:${candidate.sub_genre}` : ""}`;
  const provenance: Record<string, { tier: number; provider: string }> = {
    title: { tier: 1, provider: "isfdb" },
    publication_year: { tier: 1, provider: "isfdb" },
    isbn_13: { tier: 1, provider: "isfdb" },
    isbn_10: { tier: 1, provider: "isfdb" },
    page_count: { tier: 1, provider: "isfdb" },
    canonical_genre: { tier: 1, provider: "isfdb" },
  };
  if (seriesId) provenance.series_id = { tier: 1, provider: "isfdb" };

  const slug = `${slugify(candidate.title)}-${candidate.title_id}`;

  const { data: bookRow, error: insertErr } = await supabase
    .from("nb_books")
    .insert({
      title: candidate.title,
      slug,
      publication_year: candidate.publication_year,
      original_publication_year: candidate.publication_year,
      page_count: candidate.page_count,
      isbn_13: candidate.isbn_13,
      isbn_10: candidate.isbn_10,
      canonical_genre: canonicalGenre,
      series_id: seriesId,
      series_order: seriesId ? candidate.series_order : null,
      primary_author_id: authorId,
      popularity_score: Math.round(candidate.seed_score * 100),
      quality_score: 0,
      external_ids: {
        isfdb: {
          title_id: candidate.title_id,
          canonical_author_id: candidate.canonical_author_id,
          pub_id: candidate.canonical_pub_id,
        },
        provenance,
      },
    })
    .select("id")
    .single<{ id: string }>();
  if (insertErr) {
    console.warn(`  shell insert failed for "${candidate.title}": ${insertErr.message}`);
    return;
  }
  const workId = bookRow!.id;

  // Index updates so the next row's dedupe sees this shell.
  idx.byIsfdbTitleId.set(candidate.title_id, workId);
  if (candidate.isbn_13) idx.byIsbn13.set(candidate.isbn_13, workId);
  if (candidate.isbn_10) idx.byIsbn10.set(candidate.isbn_10, workId);
  const key = `${normaliseTitle(candidate.title)}|${authorSurname(candidate.canonical_author_name ?? "")}`;
  if (key.length > 2) idx.byTitleSurname.set(key, workId);

  // Book authors junction.
  if (authorId) {
    await supabase
      .from("nb_book_authors")
      .insert({ book_id: workId, author_id: authorId, role: "author", ordinal: 1 });
  }

  // Edition.
  if (candidate.isbn_13 || candidate.isbn_10) {
    await supabase.from("nb_editions").insert({
      work_id: workId,
      isbn_13: candidate.isbn_13,
      isbn_10: candidate.isbn_10,
      publisher: candidate.publisher,
      publication_year: candidate.publication_year,
      page_count: candidate.page_count,
      external_ids: { isfdb: { pub_id: candidate.canonical_pub_id } },
      source: "isfdb",
    });
    stats.editionsCreated++;
  }

  // Enrichment status as shell.
  await supabase.from("nb_enrichment_status").upsert({
    work_id: workId,
    metadata_status: "shell",
    embedding_status: "shell",
    coords_status: "seeded",
    cover_status: "missing",
  });
  stats.statusCreated++;

  // Seeded coordinates.
  const regionId = idx.regionsByGenre.get(candidate.canonical_genre);
  if (regionId) {
    const region = idx.regionsById.get(regionId)!;
    const coords = seededCoordsFor(region, canonicalGenre, candidate.canonical_author_name ?? "");
    await supabase.from("nb_book_coordinates").upsert({
      book_id: workId,
      region_id: regionId,
      layout_version: "v1",
      x: coords.x,
      y: coords.y,
      z: coords.z,
    });
    stats.coordsCreated++;
  }

  await insertTagsAndAwards(workId, candidate, opts, stats);

  if (opts.enqueueEnrichment) {
    await supabase.from("nb_enrichment_jobs").insert({
      work_id: workId,
      job_type: "metadata",
      priority: 80,
    });
    stats.metadataJobsEnqueued++;
  }
}

// --- Shared tags / awards inserts ---

async function insertTagsAndAwards(
  workId: string,
  candidate: ScoredCandidate,
  opts: Options,
  stats: Record<string, number>,
): Promise<void> {
  if (opts.dryRun) return;

  if (candidate.tags.length > 0) {
    const rows = candidate.tags.slice(0, 30).map((t) => ({
      book_id: workId,
      source: "isfdb",
      tag_type: "topic",
      tag_value: t.toLowerCase().trim(),
      weight: 1,
    }));
    await supabase.from("nb_book_tags").insert(rows);
    stats.tagsInserted += rows.length;
  }

  if (candidate.awards.length > 0) {
    const rows = candidate.awards.map((a) => ({
      book_id: workId,
      award_name: a.name,
      category: a.category,
      year: a.year,
      result: a.result,
      source: "isfdb",
    }));
    const { error } = await supabase.from("nb_book_awards").insert(rows);
    if (error && !/duplicate key/i.test(error.message)) {
      console.warn(`  awards insert failed: ${error.message}`);
    }
    stats.awardsInserted += rows.length;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
