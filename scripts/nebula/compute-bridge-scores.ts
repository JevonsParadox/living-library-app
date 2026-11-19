/**
 * For every book, compute a bridge_score from its semantic neighbours:
 *   - Higher when the book's neighbours span many distinct regions
 *   - Higher when those neighbour similarities are strong
 *
 * Score formula:  bridge_score = (distinct_regions / N) * sum(similarity)
 *
 * Writes/upserts into nb_book_graph_metrics.bridge_score.
 *
 * Usage: npx tsx scripts/nebula/compute-bridge-scores.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const UPSERT_BATCH = 500;

interface Edge {
  source_book_id: string;
  target_book_id: string;
  score: number;
}

async function fetchAllEdges(): Promise<Edge[]> {
  const out: Edge[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_book_edges")
      .select("source_book_id, target_book_id, score")
      .eq("edge_type", "semantic_similarity")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as Edge[]));
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

async function fetchBookRegionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_book_coordinates")
      .select("book_id, region_id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.region_id) map.set(r.book_id as string, r.region_id as string);
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return map;
}

async function main() {
  console.log("Loading semantic edges…");
  const edges = await fetchAllEdges();
  console.log(`  ${edges.length} edges`);

  console.log("Loading region map…");
  const regionByBook = await fetchBookRegionMap();
  console.log(`  ${regionByBook.size} books with regions`);

  // Group edges by source book
  const edgesBySource = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = edgesBySource.get(e.source_book_id) ?? [];
    arr.push(e);
    edgesBySource.set(e.source_book_id, arr);
  }

  console.log(`Computing bridge scores for ${edgesBySource.size} books…`);

  const updates: Array<{ book_id: string; bridge_score: number }> = [];
  for (const [bookId, neighbourEdges] of edgesBySource) {
    const sourceRegion = regionByBook.get(bookId);
    const otherRegions = new Set<string>();
    let scoreSum = 0;
    for (const e of neighbourEdges) {
      const r = regionByBook.get(e.target_book_id);
      if (r && r !== sourceRegion) otherRegions.add(r);
      scoreSum += e.score;
    }
    const N = neighbourEdges.length || 1;
    const bridgeScore = (otherRegions.size / N) * scoreSum;
    updates.push({ book_id: bookId, bridge_score: Number(bridgeScore.toFixed(4)) });
  }

  // Upsert in chunks
  let written = 0;
  for (let i = 0; i < updates.length; i += UPSERT_BATCH) {
    const batch = updates.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from("nb_book_graph_metrics").upsert(batch, { onConflict: "book_id" });
    if (error) {
      console.error(`  Batch ${i}: upsert error:`, error.message);
      continue;
    }
    written += batch.length;
    if (written % 1000 === 0 || written === updates.length) {
      console.log(`  Wrote ${written}/${updates.length}`);
    }
  }

  // Quick distribution snapshot
  const sorted = updates.map((u) => u.bridge_score).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;
  console.log(`\nDone. Bridge-score percentiles: p10=${pct(0.1).toFixed(3)} · p50=${pct(0.5).toFixed(3)} · p90=${pct(0.9).toFixed(3)} · max=${sorted[sorted.length - 1]?.toFixed(3) ?? 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
