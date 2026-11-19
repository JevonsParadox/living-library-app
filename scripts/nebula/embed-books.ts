/**
 * Generate semantic embeddings for every book using OpenAI's
 * text-embedding-3-small (1536-dim). Writes to nb_book_embeddings.
 *
 * Resumable — re-running skips books that already have an embedding.
 *
 * Usage: npx tsx scripts/nebula/embed-books.ts
 */

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const MODEL = "text-embedding-3-small";
const DIM = 1536;
const BATCH_SIZE = 100; // OpenAI accepts up to 2048 inputs; 100 keeps requests responsive
const MAX_INPUT_CHARS = 6000; // ~1500 tokens per book; well under 8K limit
const PRICE_PER_M_TOKENS = 0.02; // text-embedding-3-small as of writing

interface BookForEmbedding {
  id: string;
  title: string;
  description: string | null;
  canonical_genre: string | null;
  primary_author_id: string | null;
}

async function fetchAllBookIdsWithEmbeddings(): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_book_embeddings")
      .select("book_id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) ids.add(row.book_id as string);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return ids;
}

async function fetchAllBooks(): Promise<BookForEmbedding[]> {
  const out: BookForEmbedding[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_books")
      .select("id, title, description, canonical_genre, primary_author_id")
      .order("title")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as BookForEmbedding[]));
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

async function fetchAuthorMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_authors")
      .select("id, name")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const a of data) map.set(a.id as string, a.name as string);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return map;
}

async function fetchTagMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_book_tags")
      .select("book_id, tag_value")
      .eq("tag_type", "tag")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const arr = map.get(t.book_id as string) ?? [];
      arr.push(t.tag_value as string);
      map.set(t.book_id as string, arr);
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return map;
}

function buildText(book: BookForEmbedding, authorName: string | null, tags: string[]): string {
  const parts: string[] = [];
  parts.push(`Title: ${book.title}`);
  if (authorName) parts.push(`Author: ${authorName}`);
  if (book.canonical_genre) parts.push(`Genre: ${book.canonical_genre.replace(":", " — ").replace(/_/g, " ")}`);
  if (tags.length > 0) parts.push(`Tags: ${tags.slice(0, 12).join(", ")}`);
  if (book.description) {
    const desc = book.description.length > MAX_INPUT_CHARS
      ? book.description.slice(0, MAX_INPUT_CHARS) + "…"
      : book.description;
    parts.push(`Description: ${desc}`);
  }
  return parts.join("\n");
}

async function main() {
  console.log("Loading existing embeddings…");
  const already = await fetchAllBookIdsWithEmbeddings();
  console.log(`  ${already.size} books already embedded`);

  console.log("Fetching books…");
  const allBooks = await fetchAllBooks();
  const todo = allBooks.filter((b) => !already.has(b.id));
  console.log(`  ${allBooks.length} total · ${todo.length} to embed`);

  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("Loading authors + tags…");
  const [authors, tags] = await Promise.all([fetchAuthorMap(), fetchTagMap()]);

  let embedded = 0;
  let totalTokens = 0;
  let batchErrors = 0;

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((b) => buildText(b, b.primary_author_id ? authors.get(b.primary_author_id) ?? null : null, tags.get(b.id) ?? []));

    try {
      const res = await openai.embeddings.create({ model: MODEL, input: inputs });
      totalTokens += res.usage?.total_tokens ?? 0;

      // pgvector via PostgREST expects the literal `[v1,v2,...]` string form
      const upserts = res.data.map((d, idx) => {
        if (d.embedding.length !== DIM) {
          throw new Error(`Unexpected embedding length ${d.embedding.length}, expected ${DIM}`);
        }
        return {
          book_id: batch[idx].id,
          embedding: `[${d.embedding.join(",")}]`,
          model: MODEL,
        };
      });

      const { error } = await supabase.from("nb_book_embeddings").upsert(upserts, { onConflict: "book_id" });
      if (error) {
        console.error(`  Batch ${i}: upsert error:`, error.message);
        batchErrors++;
        continue;
      }
      embedded += upserts.length;
      console.log(`  Embedded ${embedded}/${todo.length} (batch ${Math.floor(i / BATCH_SIZE) + 1}, ~${totalTokens} tokens, ~$${(totalTokens / 1_000_000 * PRICE_PER_M_TOKENS).toFixed(4)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Batch ${i}: API error: ${msg}`);
      batchErrors++;
    }
  }

  console.log(`\nDone. Embedded ${embedded} books · ${totalTokens} total tokens · ~$${(totalTokens / 1_000_000 * PRICE_PER_M_TOKENS).toFixed(4)} · ${batchErrors} batch errors.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
