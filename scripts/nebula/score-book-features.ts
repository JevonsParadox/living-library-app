/**
 * Score all books with 10 structured feature dimensions using Claude API.
 *
 * Populates: nb_book_features
 * Resumable: skips books that already have features.
 *
 * Usage: npx tsx scripts/nebula/score-book-features.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const BATCH_SIZE = 10;
const DELAY_MS = 200;

// --- System prompt ---

const SYSTEM_PROMPT = `You are a book classification system. You score books on 10 numeric dimensions, each from 0.00 to 1.00.

The 10 dimensions:

1. fantasy_scifi_score
   0.00 = pure fantasy (magic, mythic, secondary worlds)
   1.00 = pure science fiction (technology, space, speculation)
   0.50 = science fantasy blend

2. softness_hardness_score
   0.00 = soft, lyrical, atmospheric, character-driven prose
   1.00 = hard, technical, systems-focused, rigorous worldbuilding
   0.50 = balanced

3. intimacy_epic_score
   0.00 = intimate, personal stakes, small-scale
   1.00 = epic, political, cosmic stakes, world-spanning
   0.50 = mixed scope

4. darkness_coziness_score
   0.00 = dark, grim, violent, bleak
   1.00 = cozy, warm, hopeful, gentle
   0.50 = neutral tone

5. literary_plot_score
   0.00 = plot-driven, action-focused, fast pacing
   1.00 = literary, character-driven, introspective, thematic
   0.50 = balanced

6. romance_intensity_score
   0.00 = no romance
   1.00 = romance is central to the story
   0.50 = moderate romantic subplot

7. political_adventure_score
   0.00 = pure adventure, action, exploration
   1.00 = political intrigue, diplomacy, power dynamics
   0.50 = balanced

8. weirdness_score
   0.00 = conventional, familiar genre tropes
   1.00 = very strange, experimental, surreal, genre-bending
   0.50 = somewhat unconventional

9. pacing_score
   0.00 = slow, meditative, deliberate
   1.00 = fast, propulsive, page-turner
   0.50 = moderate pace

10. worldbuilding_density_score
    0.00 = minimal worldbuilding, real-world adjacent
    1.00 = extremely dense, intricate, detailed secondary world
    0.50 = moderate worldbuilding

Rules:
- Score each book based on your knowledge of it. Use the provided metadata as context.
- If you don't recognise a book, use the genre, description, and tags to make your best estimate.
- Return ONLY valid JSON — no markdown, no explanation.
- Return an array of objects, one per book, in the same order as the input.
- Each object must have a "book_id" field and all 10 score fields.
- Scores should be to 2 decimal places (e.g., 0.75, not 0.7500).`;

// --- Types ---

interface BookRow {
  id: string;
  title: string;
  description: string | null;
  canonical_genre: string | null;
  page_count: number | null;
  publication_year: number | null;
  primary_author_id: string | null;
}

interface FeatureScores {
  book_id: string;
  fantasy_scifi_score: number;
  softness_hardness_score: number;
  intimacy_epic_score: number;
  darkness_coziness_score: number;
  literary_plot_score: number;
  romance_intensity_score: number;
  political_adventure_score: number;
  weirdness_score: number;
  pacing_score: number;
  worldbuilding_density_score: number;
}

// --- Main ---

async function main() {
  console.log("Fetching books without features...");

  // Get all book IDs that already have features (paginated)
  const scoredIds = new Set<string>();
  let featOffset = 0;
  while (true) {
    const { data } = await supabase
      .from("nb_book_features")
      .select("book_id")
      .range(featOffset, featOffset + 999);
    if (!data || data.length === 0) break;
    for (const f of data) scoredIds.add(f.book_id);
    featOffset += data.length;
    if (data.length < 1000) break;
  }

  // Get all books with metadata (paginated — Supabase defaults to 1000)
  const allBooks: BookRow[] = [];
  let bookOffset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_books")
      .select("id, title, description, canonical_genre, page_count, publication_year, primary_author_id")
      .order("title")
      .range(bookOffset, bookOffset + 999);
    if (error) {
      console.error("Failed to fetch books:", error.message);
      return;
    }
    if (!data || data.length === 0) break;
    allBooks.push(...data);
    bookOffset += data.length;
    if (data.length < 1000) break;
  }

  if (allBooks.length === 0) {
    console.error("No books found");
    return;
  }

  // Filter to unscored books
  const books = allBooks.filter((b) => !scoredIds.has(b.id));
  console.log(`${allBooks.length} total books, ${scoredIds.size} already scored, ${books.length} to score`);

  if (books.length === 0) {
    console.log("Nothing to do!");
    return;
  }

  // Fetch authors for name lookup (paginated)
  const authorMap = new Map<string, string>();
  let authOff = 0;
  while (true) {
    const { data } = await supabase.from("nb_authors").select("id, name").range(authOff, authOff + 999);
    if (!data || data.length === 0) break;
    for (const a of data) authorMap.set(a.id, a.name);
    authOff += data.length;
    if (data.length < 1000) break;
  }

  // Fetch tags for context (paginated)
  const tagMap = new Map<string, string[]>();
  let tagOff = 0;
  while (true) {
    const { data } = await supabase
      .from("nb_book_tags")
      .select("book_id, tag_value")
      .eq("tag_type", "tag")
      .range(tagOff, tagOff + 999);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const arr = tagMap.get(t.book_id) ?? [];
      arr.push(t.tag_value);
      tagMap.set(t.book_id, arr);
    }
    tagOff += data.length;
    if (data.length < 1000) break;
  }

  // Fetch series names
  const { data: series } = await supabase.from("nb_series").select("id, name");
  const seriesMap = new Map((series ?? []).map((s) => [s.id, s.name]));

  // Fetch series_id per book (paginated)
  const bookSeriesMap = new Map<string, { seriesId: string; order: number | null }>();
  let serOff = 0;
  while (true) {
    const { data } = await supabase
      .from("nb_books")
      .select("id, series_id, series_order")
      .not("series_id", "is", null)
      .range(serOff, serOff + 999);
    if (!data || data.length === 0) break;
    for (const b of data) bookSeriesMap.set(b.id, { seriesId: b.series_id, order: b.series_order });
    serOff += data.length;
    if (data.length < 1000) break;
  }

  // Process in batches
  let scored = 0;
  let errors = 0;

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);

    // Build user message with book metadata
    const booksDescription = batch.map((book) => {
      const author = book.primary_author_id ? authorMap.get(book.primary_author_id) : null;
      const bookTags = tagMap.get(book.id) ?? [];
      const seriesInfo = bookSeriesMap.get(book.id);
      const seriesName = seriesInfo ? seriesMap.get(seriesInfo.seriesId) : null;

      const parts = [
        `book_id: ${book.id}`,
        `title: ${book.title}`,
        author ? `author: ${author}` : null,
        seriesName ? `series: ${seriesName} #${seriesInfo!.order ?? "?"}` : null,
        book.canonical_genre ? `genre: ${book.canonical_genre}` : null,
        book.publication_year ? `year: ${book.publication_year}` : null,
        book.page_count ? `pages: ${book.page_count}` : null,
        bookTags.length > 0 ? `tags: ${bookTags.slice(0, 10).join(", ")}` : null,
        book.description ? `description: ${book.description.slice(0, 300)}` : null,
      ];

      return parts.filter(Boolean).join("\n");
    }).join("\n---\n");

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Score these ${batch.length} books. Return a JSON array with one object per book.\n\n${booksDescription}`,
        }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        console.error(`  Batch ${i}: no text in response`);
        errors++;
        continue;
      }

      // Parse JSON — handle potential markdown wrapping
      let jsonStr = textBlock.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const scores: FeatureScores[] = JSON.parse(jsonStr);

      // Validate and clamp scores
      const validated = scores.map((s) => ({
        book_id: s.book_id,
        fantasy_scifi_score: clamp(s.fantasy_scifi_score),
        softness_hardness_score: clamp(s.softness_hardness_score),
        intimacy_epic_score: clamp(s.intimacy_epic_score),
        darkness_coziness_score: clamp(s.darkness_coziness_score),
        literary_plot_score: clamp(s.literary_plot_score),
        romance_intensity_score: clamp(s.romance_intensity_score),
        political_adventure_score: clamp(s.political_adventure_score),
        weirdness_score: clamp(s.weirdness_score),
        pacing_score: clamp(s.pacing_score),
        worldbuilding_density_score: clamp(s.worldbuilding_density_score),
      }));

      // Upsert into nb_book_features
      const { error: upsertErr } = await supabase
        .from("nb_book_features")
        .upsert(validated, { onConflict: "book_id" });

      if (upsertErr) {
        console.error(`  Batch ${i}: upsert error:`, upsertErr.message);
        errors++;
        continue;
      }

      scored += validated.length;
      console.log(`  Scored ${scored}/${books.length} (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`  Batch ${i}: API error: ${message}`);
      errors++;
    }

    // Rate limit delay
    if (i + BATCH_SIZE < books.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone! Scored ${scored} books, ${errors} batch errors.`);
}

function clamp(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v ?? 0)) * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
