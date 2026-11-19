/**
 * Cover enrichment: find a valid cover URL for a work.
 *
 * Order: OpenLibrary Covers by ISBN (HEAD-check, rejects placeholder) ->
 *        Google Books thumbnail (from any stored source record) ->
 *        mark cover_status='failed'.
 */

import { fetchGoogleBooksByIsbn, headImage, type ProviderRecord } from "../enrichment-client";
import type { Handler, Job } from "./types";

const MIN_COVER_BYTES = 4096; // OL placeholders are ~1KB; real covers 10-200KB.

export const handleCover: Handler = async (job, ctx) => {
  if (!job.work_id) return { ok: false, error: "cover job missing work_id" };

  const { data: book } = await ctx.supabase
    .from("nb_books")
    .select("id, isbn_13, isbn_10, cover_image_url")
    .eq("id", job.work_id)
    .single<{ id: string; isbn_13: string | null; isbn_10: string | null; cover_image_url: string | null }>();
  if (!book) return { ok: false, error: "book not found" };

  if (book.cover_image_url) {
    await markCoverStatus(ctx, book.id, "present");
    return { ok: true };
  }

  const isbn = book.isbn_13 ?? book.isbn_10;

  // 1. OpenLibrary by ISBN.
  if (isbn) {
    const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
    const probe = await headImage(url);
    if (probe && probe.bytes >= MIN_COVER_BYTES) {
      await updateCover(ctx, book.id, url);
      return { ok: true };
    }
  }

  // 2. Google Books thumbnail fallback.
  let gbCover: string | null = null;
  if (isbn) {
    const gb = await fetchGoogleBooksByIsbn(isbn);
    gbCover = extractCover(gb);
  }
  if (gbCover) {
    await updateCover(ctx, book.id, gbCover);
    return { ok: true };
  }

  await markCoverStatus(ctx, book.id, "failed");
  return { ok: false, error: "no cover found" };
};

function extractCover(rec: ProviderRecord | null): string | null {
  if (!rec) return null;
  const url = rec.fields.cover_image_url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

async function updateCover(
  ctx: Parameters<Handler>[1],
  workId: string,
  url: string,
): Promise<void> {
  await ctx.supabase.from("nb_books").update({ cover_image_url: url }).eq("id", workId);
  await markCoverStatus(ctx, workId, "present");
}

async function markCoverStatus(
  ctx: Parameters<Handler>[1],
  workId: string,
  status: "present" | "failed" | "missing",
): Promise<void> {
  await ctx.supabase.from("nb_enrichment_status").upsert({
    work_id: workId,
    cover_status: status,
  });
}

export { handleCover as default };
export type { Job };
