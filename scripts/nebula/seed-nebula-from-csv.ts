/**
 * Nebula Block 2, Step 3: Import sff_seed_5000.csv into nb_ tables
 *
 * Populates: nb_authors, nb_series, nb_books, nb_book_tags, nb_regions
 *
 * Usage: npx tsx scripts/nebula/seed-nebula-from-csv.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- CSV parser ---

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// --- Regions from design packet ---

const REGIONS = [
  { name: "Mythic & Folkloric Fantasy", slug: "mythic-fantasy", anchor_x: -0.90, anchor_y: -0.45, anchor_z: 0.10, color_hex: "#8B5CF6" },
  { name: "Cozy & Heartwarming Fantasy", slug: "cozy-fantasy", anchor_x: -0.85, anchor_y: -0.60, anchor_z: -0.35, color_hex: "#F9A8D4" },
  { name: "Urban & Contemporary Fantasy", slug: "urban-fantasy", anchor_x: -0.70, anchor_y: -0.10, anchor_z: -0.05, color_hex: "#60A5FA" },
  { name: "Epic & Secondary World Fantasy", slug: "epic-fantasy", anchor_x: -0.80, anchor_y: 0.10, anchor_z: 0.80, color_hex: "#34D399" },
  { name: "Grimdark & Dark Political Fantasy", slug: "grimdark-fantasy", anchor_x: -0.72, anchor_y: 0.30, anchor_z: 0.88, color_hex: "#6B7280" },
  { name: "Romantasy & Court Fantasy", slug: "romantasy", anchor_x: -0.68, anchor_y: -0.10, anchor_z: 0.20, color_hex: "#F472B6" },
  { name: "Science Fantasy Borderlands", slug: "science-fantasy", anchor_x: -0.10, anchor_y: 0.00, anchor_z: 0.45, color_hex: "#A78BFA" },
  { name: "Dystopian & Post-Apocalyptic", slug: "dystopian", anchor_x: 0.35, anchor_y: 0.05, anchor_z: 0.35, color_hex: "#EF4444" },
  { name: "First Contact & Philosophical SF", slug: "philosophical-sf", anchor_x: 0.55, anchor_y: 0.20, anchor_z: 0.40, color_hex: "#06B6D4" },
  { name: "Space Opera & Galactic Adventure", slug: "space-opera", anchor_x: 0.75, anchor_y: 0.15, anchor_z: 0.82, color_hex: "#3B82F6" },
  { name: "Military SF & Strategy", slug: "military-sf", anchor_x: 0.78, anchor_y: 0.55, anchor_z: 0.78, color_hex: "#78716C" },
  { name: "Hard SF & Technical Speculation", slug: "hard-sf", anchor_x: 0.90, anchor_y: 0.82, anchor_z: 0.52, color_hex: "#14B8A6" },
  { name: "Cyberpunk & Near Future Tech", slug: "cyberpunk", anchor_x: 0.82, anchor_y: 0.58, anchor_z: -0.05, color_hex: "#F59E0B" },
  { name: "Weird & Experimental Speculative", slug: "weird-spec", anchor_x: 0.10, anchor_y: -0.20, anchor_z: 0.18, color_hex: "#EC4899" },
];

// Map canonical_genre to region slug
const GENRE_TO_REGION: Record<string, string> = {
  "fantasy:epic": "epic-fantasy",
  "fantasy:grimdark": "grimdark-fantasy",
  "fantasy:urban": "urban-fantasy",
  "fantasy:mythic": "mythic-fantasy",
  "fantasy:sword_and_sorcery": "epic-fantasy",
  "fantasy:academy": "epic-fantasy",
  "fantasy:comic": "cozy-fantasy",
  "fantasy:heist": "epic-fantasy",
  "fantasy:hard_magic": "epic-fantasy",
  "fantasy:hard_magic_heist": "epic-fantasy",
  "sci-fi:space_opera": "space-opera",
  "sci-fi:hard_sf": "hard-sf",
  "sci-fi:cyberpunk": "cyberpunk",
  "sci-fi:dystopian": "dystopian",
  "sci-fi:military": "military-sf",
  "sci-fi:robotics": "hard-sf",
  "sci-fi:virtual_reality": "cyberpunk",
  "sci-fi:comic": "space-opera",
};

async function seed() {
  console.log("Reading CSV...");
  const csv = readFileSync(resolve(__dirname, "../../data/nebula/sff_seed_5000.csv"), "utf-8");
  const lines = csv.replace(/\r/g, "").split("\n");
  const header = parseCSVLine(lines[0]);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = vals[j] ?? "";
    }
    rows.push(row);
  }
  console.log(`Parsed ${rows.length} rows`);

  // 1. Seed regions
  console.log("\nSeeding regions...");
  for (const r of REGIONS) {
    await supabase.from("nb_regions").upsert(
      { name: r.name, slug: r.slug, anchor_x: r.anchor_x, anchor_y: r.anchor_y, anchor_z: r.anchor_z, color_hex: r.color_hex, sort_order: REGIONS.indexOf(r) },
      { onConflict: "slug" }
    );
  }
  const { data: regionRows } = await supabase.from("nb_regions").select("id, slug");
  const regionMap = new Map(regionRows?.map((r) => [r.slug, r.id]) ?? []);
  console.log(`  ${regionMap.size} regions`);

  // 2. Collect unique authors and series
  const uniqueAuthors = new Set<string>();
  const seriesMap = new Map<string, { name: string; slug: string }>();

  for (const row of rows) {
    if (row.primary_author) uniqueAuthors.add(row.primary_author);
    if (row.series_id && row.series_name) {
      seriesMap.set(row.series_id, { name: row.series_name, slug: row.series_id });
    }
  }

  // 3. Insert authors (no unique constraint on name, so insert fresh)
  console.log(`\nSeeding ${uniqueAuthors.size} authors...`);
  const authorBatch = [...uniqueAuthors].map((name) => ({ name }));
  for (let i = 0; i < authorBatch.length; i += 100) {
    await supabase.from("nb_authors").insert(authorBatch.slice(i, i + 100));
  }
  const { data: authorRows } = await supabase.from("nb_authors").select("id, name");
  const authorIdMap = new Map(authorRows?.map((a) => [a.name, a.id]) ?? []);
  console.log(`  ${authorIdMap.size} authors in DB`);

  // 4. Insert series
  console.log(`\nSeeding ${seriesMap.size} series...`);
  const seriesBatch = [...seriesMap.values()];
  for (let i = 0; i < seriesBatch.length; i += 100) {
    await supabase.from("nb_series").upsert(seriesBatch.slice(i, i + 100), { onConflict: "slug" });
  }
  const { data: seriesRows } = await supabase.from("nb_series").select("id, slug");
  const seriesIdMap = new Map(seriesRows?.map((s) => [s.slug, s.id]) ?? []);
  console.log(`  ${seriesIdMap.size} series in DB`);

  // 5. Insert books
  console.log(`\nSeeding ${rows.length} books...`);
  let bookCount = 0;

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const bookInserts = batch.map((row) => ({
      title: row.canonical_title,
      description: row.description || null,
      publication_year: row.publication_year ? parseInt(row.publication_year) : null,
      page_count: row.page_count ? parseInt(row.page_count) : null,
      language_code: row.language || "en",
      isbn_10: row.isbn_10 || null,
      isbn_13: row.isbn_13 || null,
      cover_image_url: row.cover_url || null,
      canonical_genre: row.canonical_genre || null,
      popularity_score: row.popularity_score ? parseFloat(row.popularity_score) : 0,
      series_id: row.series_id ? (seriesIdMap.get(row.series_id) ?? null) : null,
      series_order: row.series_order ? parseFloat(row.series_order) : null,
      primary_author_id: row.primary_author ? (authorIdMap.get(row.primary_author) ?? null) : null,
    }));

    const { data: inserted, error } = await supabase.from("nb_books").insert(bookInserts).select("id, title, canonical_genre");
    if (error) {
      console.error(`  Batch ${i} error:`, error.message);
      continue;
    }
    bookCount += inserted?.length ?? 0;

    // Insert tags for this batch
    if (inserted) {
      const tagInserts: { book_id: string; tag_type: string; tag_value: string; source: string }[] = [];
      for (let j = 0; j < inserted.length; j++) {
        const row = batch[j];
        const bookId = inserted[j].id;

        // Tags
        if (row.tags) {
          for (const tag of row.tags.split(",").filter(Boolean)) {
            tagInserts.push({ book_id: bookId, tag_type: "tag", tag_value: tag.trim(), source: "goodbooks-10k" });
          }
        }

        // Source
        if (row.source_list) {
          tagInserts.push({ book_id: bookId, tag_type: "source", tag_value: row.source_list, source: "pipeline" });
        }
      }

      if (tagInserts.length > 0) {
        for (let t = 0; t < tagInserts.length; t += 200) {
          await supabase.from("nb_book_tags").insert(tagInserts.slice(t, t + 200));
        }
      }

      // Assign books to regions based on canonical_genre
      const coordInserts: { book_id: string; x: number; y: number; z: number; region_id: string }[] = [];
      for (const book of inserted) {
        const regionSlug = GENRE_TO_REGION[book.canonical_genre ?? ""] ?? "space-opera";
        const regionId = regionMap.get(regionSlug);
        const region = REGIONS.find((r) => r.slug === regionSlug);
        if (regionId && region) {
          // Offset from region anchor with some randomness
          const jitter = () => (Math.random() - 0.5) * 0.15;
          coordInserts.push({
            book_id: book.id,
            x: region.anchor_x + jitter(),
            y: region.anchor_y + jitter(),
            z: region.anchor_z + jitter(),
            region_id: regionId,
          });
        }
      }

      if (coordInserts.length > 0) {
        for (let c = 0; c < coordInserts.length; c += 100) {
          await supabase.from("nb_book_coordinates").insert(coordInserts.slice(c, c + 100));
        }
      }
    }

    if ((i + 50) % 500 === 0) console.log(`  ${Math.min(i + 50, rows.length)}/${rows.length}...`);
  }

  console.log(`\nDone! Seeded:`);
  console.log(`  ${bookCount} books`);
  console.log(`  ${authorIdMap.size} authors`);
  console.log(`  ${seriesIdMap.size} series`);
  console.log(`  ${regionMap.size} regions`);
}

seed().catch(console.error);
