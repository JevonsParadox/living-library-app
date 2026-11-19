/**
 * One-shot backfill: enqueue a `paraphrase` job for every nb_books row that
 * has a non-empty description but no short_description. The paraphrase
 * handler generates an LLM-paraphrased short_description so the UI never
 * needs to display raw provider text.
 *
 * Idempotent: skips books that already have a pending/running/completed
 * paraphrase job queued.
 *
 * Cost: ~$0.00021 per book at gpt-4o-mini rates (~$1 for 4,497 books).
 *
 * Usage: npx tsx scripts/nebula/backfill-paraphrase-queue.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DRY_RUN = process.argv.includes("--dry-run");

interface BookNeedingParaphrase {
  id: string;
}

async function fetchCandidates(): Promise<BookNeedingParaphrase[]> {
  const out: BookNeedingParaphrase[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_books")
      .select("id")
      .not("description", "is", null)
      .is("short_description", null)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as BookNeedingParaphrase[]));
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function fetchExistingJobs(): Promise<Set<string>> {
  const out = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("nb_enrichment_jobs")
      .select("work_id")
      .eq("job_type", "paraphrase")
      .in("state", ["pending", "running", "completed"])
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data as { work_id: string }[]) out.add(row.work_id);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

async function main() {
  console.log("loading candidates (nb_books with description and no short_description)...");
  const candidates = await fetchCandidates();
  console.log(`  ${candidates.length} candidates`);

  console.log("loading existing paraphrase jobs...");
  const existing = await fetchExistingJobs();
  console.log(`  ${existing.size} already queued/running/completed`);

  const toQueue = candidates.filter((c) => !existing.has(c.id));
  console.log(`  ${toQueue.length} to enqueue`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — not inserting");
    return;
  }

  if (toQueue.length === 0) {
    console.log("nothing to do.");
    return;
  }

  // Batch insert 500 at a time.
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < toQueue.length; i += BATCH) {
    const batch = toQueue.slice(i, i + BATCH).map((c) => ({
      work_id: c.id,
      job_type: "paraphrase",
      priority: 120, // below user-triggered metadata (30) and seed enrichment (80)
    }));
    const { error } = await supabase.from("nb_enrichment_jobs").insert(batch);
    if (error) {
      console.error(`  batch ${i}: insert error: ${error.message}`);
      continue;
    }
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${toQueue.length}`);
  }

  console.log(`\ndone. Enqueued ${inserted} paraphrase jobs.`);
  console.log("Run the worker to process them:");
  console.log("  npx tsx scripts/nebula/run-enrichment-worker.ts --loop --types=paraphrase --concurrency=5");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
