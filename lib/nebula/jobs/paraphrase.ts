/**
 * Paraphrase job: takes an existing `description` and generates a
 * `short_description` via LLM. Used for backfilling the ~4,497 legacy books
 * that were seeded with raw descriptions (copyright risk if displayed).
 *
 * Skips any book that already has `short_description` OR has no `description`.
 * Sets `external_ids.provenance.short_description = { tier: 4, provider: 'llm' }`.
 *
 * Cheap: one OpenAI call per book, no external API fetches.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { paraphraseDescription } from "./paraphrase-shared";
import type { Handler, HandlerResult } from "./types";

export const handleParaphrase: Handler = async (job, ctx) => {
  if (!job.work_id) return { ok: false, error: "paraphrase job missing work_id" };

  const { data: book, error: loadErr } = await ctx.supabase
    .from("nb_books")
    .select("id, title, description, short_description, primary_author_id, external_ids")
    .eq("id", job.work_id)
    .single<{
      id: string;
      title: string;
      description: string | null;
      short_description: string | null;
      primary_author_id: string | null;
      external_ids: Record<string, unknown> | null;
    }>();
  if (loadErr || !book) return { ok: false, error: `load book failed: ${loadErr?.message}` };

  if (book.short_description && book.short_description.length > 20) {
    return { ok: true }; // nothing to do — already paraphrased
  }
  if (!book.description || book.description.trim().length < 40) {
    return { ok: false, error: "no paraphraseable description" };
  }

  const authorName = await loadAuthorName(ctx.supabase, book.primary_author_id);

  const paraphrase = await paraphraseDescription(
    ctx.openai,
    book.description,
    book.title,
    authorName ?? "Unknown",
  );
  if (!paraphrase) return { ok: false, error: "LLM returned no paraphrase" };

  const existing = (book.external_ids ?? {}) as Record<string, unknown>;
  const provenance =
    ((existing.provenance as Record<string, { tier: number; provider: string }> | undefined) ??
      {}) as Record<string, { tier: number; provider: string }>;
  provenance.short_description = { tier: 4, provider: "llm" };

  const { error: updateErr } = await ctx.supabase
    .from("nb_books")
    .update({
      short_description: paraphrase,
      external_ids: { ...existing, provenance },
    })
    .eq("id", book.id);
  if (updateErr) return { ok: false, error: `update failed: ${updateErr.message}` };

  return { ok: true };
};

async function loadAuthorName(
  supabase: SupabaseClient,
  authorId: string | null,
): Promise<string | null> {
  if (!authorId) return null;
  const { data } = await supabase
    .from("nb_authors")
    .select("name")
    .eq("id", authorId)
    .single();
  return (data?.name as string) ?? null;
}

export type { HandlerResult };
