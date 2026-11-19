/**
 * Popular-path promotion. Nightly cron: works with engagement_score above a
 * threshold get their metadata_next_refresh_at pulled forward so they re-enrich
 * more often than the default 180-day cadence.
 *
 * The refresh itself is triggered inside the enrichment worker — there's a
 * startup pass that enqueues a metadata job for any work whose
 * metadata_next_refresh_at has passed and that has no active job queued.
 *
 * Usage: npx tsx scripts/nebula/promote-popular-works.ts [--threshold=50] [--interval-days=90] [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function parseArgs() {
  let threshold = 50;
  let intervalDays = 90;
  let dryRun = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--threshold=")) threshold = Number(a.split("=")[1]) || threshold;
    else if (a.startsWith("--interval-days=")) intervalDays = Number(a.split("=")[1]) || intervalDays;
    else if (a === "--dry-run") dryRun = true;
  }
  return { threshold, intervalDays, dryRun };
}

async function main() {
  const { threshold, intervalDays, dryRun } = parseArgs();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Find popular works.
  const { data: popular, error: err1 } = await supabase
    .from("nb_books")
    .select("id, engagement_score")
    .gte("engagement_score", threshold);
  if (err1) throw new Error(err1.message);

  const ids = (popular ?? []).map((r) => r.id as string);
  console.log(`${ids.length} works with engagement_score >= ${threshold}`);

  if (dryRun) {
    console.log("DRY RUN — not updating nb_enrichment_status");
    return;
  }
  if (ids.length === 0) {
    console.log("nothing to promote.");
    return;
  }

  const newRefresh = new Date(Date.now() + intervalDays * 24 * 3600 * 1000).toISOString();

  // Chunk to keep the IN-list reasonable.
  const BATCH = 500;
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("nb_enrichment_status")
      .update({ metadata_next_refresh_at: newRefresh })
      .in("work_id", chunk)
      .or(`metadata_next_refresh_at.is.null,metadata_next_refresh_at.gt.${newRefresh}`)
      .select("work_id");
    if (error) {
      console.error(`  batch ${i}: ${error.message}`);
      continue;
    }
    updated += data?.length ?? 0;
  }

  console.log(`promoted: ${updated} works now refresh at ${newRefresh}`);

  await supabase.from("nb_external_source_runs").insert({
    provider: "popular_path_promotion",
    mode: "delta",
    status: "completed",
    finished_at: new Date().toISOString(),
    stats: { threshold, interval_days: intervalDays, promoted: updated, candidates: ids.length },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
