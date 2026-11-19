/**
 * For each book, find its top-K nearest semantic neighbours via pgvector
 * cosine similarity, and write them as `semantic_similarity` rows in
 * nb_book_edges.
 *
 * Idempotent: upserts on (source_book_id, target_book_id, edge_type).
 *
 * Usage: npx tsx scripts/nebula/build-similarity-edges.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const K = 8; // neighbours per book
const RPC_NAME = "nb_nearest_books";
const UPSERT_BATCH = 500;

interface Neighbour {
  book_id: string;
  distance: number;
}

async function ensureRpcExists() {
  // We use an inline RPC call via .rpc() — Supabase needs the function defined.
  // The migration adds it; this is a runtime sanity check.
  const { error } = await supabase.rpc(RPC_NAME, { p_book_id: "00000000-0000-0000-0000-000000000000", p_k: 1 });
  if (error && !error.message.includes("0 rows")) {
    throw new Error(
      `RPC ${RPC_NAME} not available: ${error.message}.\n` +
      `Apply the migration that defines it (00201).`
    );
  }
}

async function fetchAllSourceIds(): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_book_embeddings")
      .select("book_id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) out.push(r.book_id as string);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

async function nearest(bookId: string, k: number): Promise<Neighbour[]> {
  const { data, error } = await supabase.rpc(RPC_NAME, { p_book_id: bookId, p_k: k });
  if (error) {
    console.error(`  nearest(${bookId}) error:`, error.message);
    return [];
  }
  return (data ?? []) as Neighbour[];
}

async function main() {
  console.log("Sanity-checking RPC…");
  await ensureRpcExists();

  console.log("Loading source book ids from nb_book_embeddings…");
  const sourceIds = await fetchAllSourceIds();
  console.log(`  ${sourceIds.length} books with embeddings`);

  if (sourceIds.length === 0) {
    console.log("Nothing to do — run embed-books.ts first.");
    return;
  }

  // Buffer rows and upsert in chunks for throughput
  let pending: Array<{ source_book_id: string; target_book_id: string; edge_type: string; score: number; rank: number }> = [];
  let totalEdges = 0;
  let processed = 0;

  const flush = async () => {
    if (pending.length === 0) return;
    const { error } = await supabase
      .from("nb_book_edges")
      .upsert(pending, { onConflict: "source_book_id,target_book_id,edge_type" });
    if (error) {
      console.error("  upsert error:", error.message);
    } else {
      totalEdges += pending.length;
    }
    pending = [];
  };

  for (const sourceId of sourceIds) {
    // Ask for K+1 because the source itself is its own nearest neighbour
    const neighbours = await nearest(sourceId, K + 1);
    let rank = 0;
    for (const n of neighbours) {
      if (n.book_id === sourceId) continue;
      rank += 1;
      if (rank > K) break;
      pending.push({
        source_book_id: sourceId,
        target_book_id: n.book_id,
        edge_type: "semantic_similarity",
        score: Math.max(0, 1 - n.distance), // cosine_distance → similarity
        rank,
      });
      if (pending.length >= UPSERT_BATCH) await flush();
    }
    processed += 1;
    if (processed % 100 === 0) {
      console.log(`  Processed ${processed}/${sourceIds.length} books · ${totalEdges + pending.length} edges`);
    }
  }
  await flush();

  console.log(`\nDone. ${totalEdges} edges written across ${sourceIds.length} books.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
