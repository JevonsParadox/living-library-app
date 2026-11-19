/**
 * Audit existing nb_books for likely-duplicate pairs and seed them into
 * nb_review_queue for an admin to resolve.
 *
 * Combined signal:
 *   - embedding cosine similarity (from nb_book_embeddings via pgvector)
 *   - trigram similarity on the canonical title strings
 *
 * A pair must clear BOTH thresholds to be considered. Default thresholds:
 *   embedding ≥ 0.92, trigram ≥ 0.40, top 500 by combined score.
 *
 * Idempotent: nb_review_queue has a unique constraint on
 *   (canonical_work_id, duplicate_work_id, source).
 *
 * Cost: zero. All work is local + DB. Runs in <1 minute on 12k books.
 *
 * Usage:
 *   npx tsx scripts/nebula/audit-duplicates.ts [--threshold-embedding=0.92]
 *                                              [--threshold-trigram=0.40]
 *                                              [--limit=500] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

import { normaliseTitle } from "../../lib/nebula/title-normalise";

config({ path: resolve(__dirname, "../../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Args {
  thresholdEmbedding: number;
  thresholdTrigram: number;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    thresholdEmbedding: 0.92,
    thresholdTrigram: 0.4,
    limit: 500,
    dryRun: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--threshold-embedding=")) {
      args.thresholdEmbedding = Number(a.split("=")[1]);
    } else if (a.startsWith("--threshold-trigram=")) {
      args.thresholdTrigram = Number(a.split("=")[1]);
    } else if (a.startsWith("--limit=")) {
      args.limit = Number(a.split("=")[1]);
    } else if (a === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

interface BookForAudit {
  id: string;
  title: string;
  primary_author_id: string | null;
}

async function fetchBooksWithEmbeddings(): Promise<BookForAudit[]> {
  // We only audit books that actually have an embedding; pairs without one
  // can't be scored on the cosine axis. Two-query approach to keep types
  // simple.
  const ids = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_book_embeddings")
      .select("book_id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as { book_id: string }[]) ids.add(r.book_id);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const out: BookForAudit[] = [];
  const idArr = Array.from(ids);
  // Smaller chunks: 1000 UUIDs in an `.in()` produces a GET URL ~37 KB long
  // which Supabase's PostgREST rejects with "Bad Request". 200 fits comfortably.
  const CHUNK = 200;
  for (let i = 0; i < idArr.length; i += CHUNK) {
    const chunk = idArr.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("nb_books")
      .select("id, title, primary_author_id")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const b of (data ?? []) as BookForAudit[]) out.push(b);
  }
  return out;
}

interface NeighbourPair {
  a: string;
  b: string;
  cosine: number;
}

/**
 * Use the existing nb_nearest_books RPC (migration 00201) to find the top-k
 * neighbours per book. Signature: (p_book_id uuid, p_k int) returning
 * (book_id, distance) where distance is pgvector cosine distance in [0, 2]
 * (0 = identical). We convert to similarity = 1 - distance for ranking.
 *
 * The RPC returns the query book itself (distance 0) — we filter it out.
 * We use k+1 so we still get k actual neighbours after the self-row drops.
 */
async function findNearestPairs(books: BookForAudit[], k = 3): Promise<NeighbourPair[]> {
  const seen = new Set<string>();
  const pairs: NeighbourPair[] = [];

  for (let i = 0; i < books.length; i++) {
    if (i % 1000 === 0) {
      console.log(`  scanning neighbours: ${i}/${books.length}`);
    }
    const { data, error } = await supabase.rpc("nb_nearest_books", {
      p_book_id: books[i].id,
      p_k: k + 1,
    });
    if (error) {
      console.error(`  rpc failed for ${books[i].id}: ${error.message}`);
      continue;
    }
    for (const row of (data ?? []) as Array<{ book_id: string; distance: number }>) {
      if (!row?.book_id || row.book_id === books[i].id) continue;
      const similarity = 1 - Number(row.distance);
      const [aId, bId] = books[i].id < row.book_id
        ? [books[i].id, row.book_id]
        : [row.book_id, books[i].id];
      const key = `${aId}|${bId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a: aId, b: bId, cosine: similarity });
    }
  }
  return pairs;
}

/** Bigram Dice coefficient on two normalised strings. */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let intersection = 0;
  for (const [g, ca] of A) intersection += Math.min(ca, B.get(g) ?? 0);
  const total = [...A.values()].reduce((s, n) => s + n, 0) + [...B.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}

async function main() {
  const args = parseArgs();
  console.log(
    `audit-duplicates: embed≥${args.thresholdEmbedding} trigram≥${args.thresholdTrigram} limit=${args.limit}${args.dryRun ? " [DRY RUN]" : ""}`,
  );

  console.log("loading books with embeddings...");
  const books = await fetchBooksWithEmbeddings();
  console.log(`  ${books.length} books with embeddings`);
  if (books.length === 0) return;

  const bookById = new Map(books.map((b) => [b.id, b]));

  console.log("finding nearest-neighbour pairs (top 3 per book)...");
  const allPairs = await findNearestPairs(books, 3);
  console.log(`  ${allPairs.length} unique pairs`);

  // Filter by embedding threshold + compute trigram on titles.
  console.log("scoring pairs (embedding + trigram)...");
  const scored = allPairs
    .filter((p) => p.cosine >= args.thresholdEmbedding)
    .map((p) => {
      const a = bookById.get(p.a);
      const b = bookById.get(p.b);
      const trigram = a && b ? dice(normaliseTitle(a.title), normaliseTitle(b.title)) : 0;
      const combined = 0.6 * p.cosine + 0.4 * trigram;
      return { ...p, trigram, combined };
    })
    .filter((p) => p.trigram >= args.thresholdTrigram)
    .sort((a, b) => b.combined - a.combined)
    .slice(0, args.limit);

  console.log(`  ${scored.length} candidate pairs above thresholds`);

  if (scored.length === 0) {
    console.log("nothing to enqueue.");
    return;
  }

  if (args.dryRun) {
    console.log("\nTop 10 candidates (dry run):");
    for (const p of scored.slice(0, 10)) {
      const a = bookById.get(p.a)!;
      const b = bookById.get(p.b)!;
      console.log(
        `  cos=${p.cosine.toFixed(3)} tri=${p.trigram.toFixed(3)} | "${a.title}" <-> "${b.title}"`,
      );
    }
    return;
  }

  console.log("inserting into nb_review_queue...");
  const rows = scored.map((p) => ({
    source: "duplicate" as const,
    canonical_work_id: p.a,
    duplicate_work_id: p.b,
    similarity: Number(p.combined.toFixed(3)),
    signal_breakdown: { embedding: p.cosine, trigram: p.trigram, combined: p.combined },
    status: "pending" as const,
  }));

  // Insert in chunks; rely on the unique index to skip prior runs' rows.
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("nb_review_queue")
      .upsert(batch, {
        onConflict: "canonical_work_id,duplicate_work_id,source",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      console.error(`  batch ${i}: ${error.message}`);
      continue;
    }
    inserted += data?.length ?? 0;
  }
  console.log(`done. ${inserted} new queue rows inserted (existing pairs skipped).`);

  await supabase.from("nb_external_source_runs").insert({
    provider: "audit_duplicates",
    mode: "delta",
    status: "completed",
    finished_at: new Date().toISOString(),
    stats: {
      threshold_embedding: args.thresholdEmbedding,
      threshold_trigram: args.thresholdTrigram,
      limit: args.limit,
      candidates: scored.length,
      inserted,
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
