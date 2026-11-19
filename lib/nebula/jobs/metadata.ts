/**
 * Metadata enrichment: pull from ISFDB (stub) -> OpenLibrary -> Google Books,
 * merge via source-tier policy, LLM-paraphrase any returned synopsis into
 * short_description, write back to nb_books / nb_book_tags / nb_source_records.
 *
 * Enqueues follow-up embedding + cover + coords jobs on success.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchGoogleBooksByIsbn,
  fetchGoogleBooksByTitleAuthor,
  fetchIsfdbLocal,
  fetchOpenLibraryByIsbn,
  fetchOpenLibraryByTitleAuthor,
  type ProviderRecord,
} from "../enrichment-client";
import { paraphraseDescription } from "./paraphrase-shared";
import { getIsfdbTitleId, mergeExternalIds, type ExternalIds } from "../external-ids";
import {
  mergeBookFields,
  SOURCE_TIER,
  type Provenance,
  type ProvenanceEntry,
} from "../merge-policy";
import type { Handler, HandlerResult, Job } from "./types";

type ExternalIdsObject = ExternalIds & {
  provenance?: Provenance;
};

// Provider fields that map directly to nb_books scalar columns.
// `primary_author`, `publisher`, `tags`, `series_name` are handled separately
// (author FK, edition-level, tag rows, series FK) and must not leak into the
// nb_books UPDATE.
const NB_BOOKS_PATCHABLE: readonly string[] = [
  "title",
  "publication_year",
  "description",
  "short_description",
  "isbn_13",
  "isbn_10",
  "page_count",
  "cover_image_url",
  "series_order",
  "external_ids",
] as const;

const BOOK_COLUMNS =
  "id, title, subtitle, description, short_description, publication_year, page_count, cover_image_url, isbn_13, isbn_10, external_ids, primary_author_id";

interface BookRow {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  short_description: string | null;
  publication_year: number | null;
  page_count: number | null;
  cover_image_url: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  external_ids: ExternalIdsObject | null;
  primary_author_id: string | null;
}

export const handleMetadata: Handler = async (job, ctx) => {
  if (!job.work_id) return { ok: false, error: "metadata job missing work_id" };

  const { data: book, error: loadErr } = await ctx.supabase
    .from("nb_books")
    .select(BOOK_COLUMNS)
    .eq("id", job.work_id)
    .single<BookRow>();
  if (loadErr || !book) return { ok: false, error: `load book failed: ${loadErr?.message}` };

  const authorName = await loadAuthorName(ctx.supabase, book.primary_author_id);
  if (!authorName) return { ok: false, error: "primary author not found" };

  // 1. Try each provider in priority order.
  const providerRecords: ProviderRecord[] = [];

  const isfdbId = getIsfdbTitleId(book.external_ids ?? {});
  if (isfdbId) {
    const r = await fetchIsfdbLocal(isfdbId);
    if (r) providerRecords.push(r);
  }

  // ISBN lookup first; if it yields nothing, fall back to title+author search.
  const isbn = book.isbn_13 ?? book.isbn_10;
  if (isbn) {
    const ol = await fetchOpenLibraryByIsbn(isbn);
    if (ol) providerRecords.push(ol);
    const gb = await fetchGoogleBooksByIsbn(isbn);
    if (gb) providerRecords.push(gb);
  }
  if (providerRecords.length === 0) {
    const ol = await fetchOpenLibraryByTitleAuthor(book.title, authorName);
    if (ol) providerRecords.push(ol);
    const gb = await fetchGoogleBooksByTitleAuthor(book.title, authorName);
    if (gb) providerRecords.push(gb);
  }

  // 2. Merge via source-tier policy.
  let patch: Record<string, unknown> = {};
  let provenance: Provenance = { ...(book.external_ids?.provenance ?? {}) };
  const existing = {
    title: book.title,
    publication_year: book.publication_year,
    description: book.description,
    page_count: book.page_count,
    cover_image_url: book.cover_image_url,
    isbn_13: book.isbn_13,
    isbn_10: book.isbn_10,
  };

  for (const rec of providerRecords) {
    const merged = mergeBookFields({
      existing: { ...existing, ...patch },
      existingProvenance: provenance,
      incoming: rec,
    });
    patch = { ...patch, ...merged.patch };
    provenance = merged.newProvenance;
  }

  // 3. LLM paraphrase -> short_description (if we have a fresh description and no short yet).
  const chosenDescription = (patch.description ?? book.description) as string | null;
  if (chosenDescription && !book.short_description) {
    const paraphrase = await paraphraseDescription(ctx.openai, chosenDescription, book.title, authorName);
    if (paraphrase) {
      patch.short_description = paraphrase;
      provenance.short_description = { tier: SOURCE_TIER.llm, provider: "llm" } satisfies ProvenanceEntry;
    }
  }

  // 4. Fold provenance + provider ids back into external_ids.
  const providerIdPatch: Record<string, Record<string, unknown>> = {};
  const olHit = providerRecords.find((r) => r.provider === "openlibrary");
  if (olHit) providerIdPatch.openlibrary = { work_id: olHit.provider_record_id };
  const gbHit = providerRecords.find((r) => r.provider === "google_books");
  if (gbHit) providerIdPatch.google_books = { volume_id: gbHit.provider_record_id };

  const newExternalIds = mergeExternalIds(book.external_ids ?? {}, providerIdPatch);
  (newExternalIds as ExternalIdsObject).provenance = provenance;
  patch.external_ids = newExternalIds;

  const filteredPatch: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    if (NB_BOOKS_PATCHABLE.includes(k)) filteredPatch[k] = patch[k];
  }
  if (Object.keys(filteredPatch).length > 0) {
    const { error: updateErr } = await ctx.supabase
      .from("nb_books")
      .update(filteredPatch)
      .eq("id", book.id);
    if (updateErr) return { ok: false, error: `update nb_books failed: ${updateErr.message}` };
  }

  // 5. Record provenance (raw payloads).
  for (const rec of providerRecords) {
    await ctx.supabase.from("nb_source_records").insert({
      work_id: book.id,
      provider: rec.provider,
      provider_record_id: rec.provider_record_id,
      payload: rec.raw as Record<string, unknown>,
    });
  }

  // 6. Tags (dedupe against existing by (source, tag_value)).
  const allTags: { source: string; value: string }[] = [];
  for (const rec of providerRecords) {
    for (const t of rec.fields.tags ?? []) {
      if (typeof t === "string" && t.trim()) {
        allTags.push({ source: rec.provider, value: t.trim().toLowerCase() });
      }
    }
  }
  if (allTags.length > 0) {
    const tagRows = allTags.slice(0, 40).map((t) => ({
      book_id: book.id,
      source: t.source,
      tag_type: "topic",
      tag_value: t.value,
      weight: 1,
    }));
    // Ignore conflicts on the implicit dedupe (no uniq constraint exists; best-effort insert).
    await ctx.supabase.from("nb_book_tags").insert(tagRows);
  }

  // 7. Update enrichment status.
  await ctx.supabase
    .from("nb_enrichment_status")
    .upsert({
      work_id: book.id,
      metadata_status: "enriched",
      metadata_last_enriched_at: new Date().toISOString(),
      metadata_next_refresh_at: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
      last_error: null,
    });

  // 8. Enqueue follow-ups.
  const followUps: Array<{ work_id: string; job_type: string; priority: number }> = [];
  if (patch.description || patch.title || patch.short_description) {
    followUps.push({ work_id: book.id, job_type: "embedding", priority: 50 });
  }
  if (!book.cover_image_url && !patch.cover_image_url) {
    followUps.push({ work_id: book.id, job_type: "cover", priority: 40 });
  }
  if (followUps.length > 0) {
    // Unique index on (work_id, job_type) WHERE state in ('pending','running')
    // swallows duplicates automatically.
    for (const fu of followUps) {
      await ctx.supabase.from("nb_enrichment_jobs").insert(fu);
    }
  }

  return { ok: true };
};

async function loadAuthorName(
  supabase: SupabaseClient,
  authorId: string | null,
): Promise<string | null> {
  if (!authorId) return null;
  const { data } = await supabase.from("nb_authors").select("name").eq("id", authorId).single();
  return (data?.name as string) ?? null;
}

async function markStatus(
  supabase: SupabaseClient,
  workId: string,
  status: string,
  error: string,
): Promise<void> {
  await supabase
    .from("nb_enrichment_status")
    .upsert({ work_id: workId, metadata_status: status, last_error: error });
}

export { handleMetadata as default };
export type { HandlerResult, Job };
