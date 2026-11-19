/**
 * Embedding enrichment: build the same input text as scripts/nebula/embed-books.ts,
 * hash it, skip if the hash matches the stored input_hash, else embed + upsert.
 *
 * Enqueues a coords refresh if the embedding actually changed.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Handler, HandlerResult } from "./types";

const MODEL = "text-embedding-3-small";
const DIM = 1536;
const MAX_INPUT_CHARS = 6000;

export const handleEmbedding: Handler = async (job, ctx) => {
  if (!job.work_id) return { ok: false, error: "embedding job missing work_id" };

  const input = await buildInputText(ctx.supabase, job.work_id);
  if (!input) return { ok: false, error: "could not build embedding input" };

  const inputHash = sha256(input);

  const { data: existing } = await ctx.supabase
    .from("nb_book_embeddings")
    .select("book_id, input_hash")
    .eq("book_id", job.work_id)
    .maybeSingle<{ book_id: string; input_hash: string | null }>();

  if (existing && existing.input_hash === inputHash) {
    await markStatus(ctx.supabase, job.work_id, "enriched");
    return { ok: true };
  }

  let embedding: number[];
  try {
    const res = await ctx.openai.embeddings.create({ model: MODEL, input });
    embedding = res.data[0]?.embedding ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markStatus(ctx.supabase, job.work_id, "failed", msg);
    return { ok: false, error: `openai embed failed: ${msg}` };
  }
  if (embedding.length !== DIM) {
    return { ok: false, error: `unexpected embedding length ${embedding.length}` };
  }

  const { error: upErr } = await ctx.supabase.from("nb_book_embeddings").upsert(
    {
      book_id: job.work_id,
      embedding: `[${embedding.join(",")}]`,
      model: MODEL,
      input_hash: inputHash,
    },
    { onConflict: "book_id" },
  );
  if (upErr) {
    await markStatus(ctx.supabase, job.work_id, "failed", upErr.message);
    return { ok: false, error: `upsert embedding failed: ${upErr.message}` };
  }

  await markStatus(ctx.supabase, job.work_id, "enriched");

  // Enqueue coords refresh since the embedding moved.
  await ctx.supabase
    .from("nb_enrichment_jobs")
    .insert({ work_id: job.work_id, job_type: "coords", priority: 60 });

  return { ok: true };
};

async function buildInputText(supabase: SupabaseClient, workId: string): Promise<string | null> {
  const { data: book } = await supabase
    .from("nb_books")
    .select("id, title, description, short_description, canonical_genre, primary_author_id")
    .eq("id", workId)
    .single<{
      id: string;
      title: string;
      description: string | null;
      short_description: string | null;
      canonical_genre: string | null;
      primary_author_id: string | null;
    }>();
  if (!book) return null;

  let authorName: string | null = null;
  if (book.primary_author_id) {
    const { data: a } = await supabase
      .from("nb_authors")
      .select("name")
      .eq("id", book.primary_author_id)
      .single<{ name: string }>();
    authorName = a?.name ?? null;
  }

  const { data: tagRows } = await supabase
    .from("nb_book_tags")
    .select("tag_value")
    .eq("book_id", workId)
    .limit(12);
  const tags = (tagRows ?? []).map((r) => r.tag_value as string);

  const parts: string[] = [`Title: ${book.title}`];
  if (authorName) parts.push(`Author: ${authorName}`);
  if (book.canonical_genre) {
    parts.push(`Genre: ${book.canonical_genre.replace(":", " — ").replace(/_/g, " ")}`);
  }
  if (tags.length > 0) parts.push(`Tags: ${tags.join(", ")}`);
  const desc = book.short_description ?? book.description;
  if (desc) {
    const trimmed = desc.length > MAX_INPUT_CHARS ? `${desc.slice(0, MAX_INPUT_CHARS)}…` : desc;
    parts.push(`Description: ${trimmed}`);
  }
  return parts.join("\n");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function markStatus(
  supabase: SupabaseClient,
  workId: string,
  status: "enriched" | "failed" | "stale" | "shell",
  error?: string,
): Promise<void> {
  await supabase.from("nb_enrichment_status").upsert({
    work_id: workId,
    embedding_status: status,
    embedding_last_enriched_at: status === "enriched" ? new Date().toISOString() : undefined,
    last_error: error ?? null,
  });
}

export { handleEmbedding as default };
export type { HandlerResult };
