/**
 * Engagement-score rollup: aggregates nb_popularity_signals into
 * nb_books.engagement_score for the trailing 90 days.
 *
 * Runs via the nb_rollup_engagement Postgres function added in 00350.
 * Logs a row into nb_external_source_runs for observability.
 *
 * Usage: npx tsx scripts/nebula/rollup-engagement.ts [--window-days=90]
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function parseWindowDays(): number {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--window-days=")) return Number(a.split("=")[1]) || 90;
  }
  return 90;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const windowDays = parseWindowDays();

  const startedAt = Date.now();
  const { data, error } = await supabase.rpc("nb_rollup_engagement", {
    p_window_days: windowDays,
  });
  const durationMs = Date.now() - startedAt;

  if (error) {
    console.error("rollup failed:", error.message);
    await supabase.from("nb_external_source_runs").insert({
      provider: "engagement_rollup",
      mode: "delta",
      status: "failed",
      finished_at: new Date().toISOString(),
      error_text: error.message,
      stats: { window_days: windowDays, duration_ms: durationMs },
    });
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : [data];
  const rowsUpdated = Number(rows?.[0]?.rows_updated ?? 0);

  console.log(
    `rollup complete: rowsUpdated=${rowsUpdated} windowDays=${windowDays} durationMs=${durationMs}`,
  );

  await supabase.from("nb_external_source_runs").insert({
    provider: "engagement_rollup",
    mode: "delta",
    status: "completed",
    finished_at: new Date().toISOString(),
    stats: { window_days: windowDays, rows_updated: rowsUpdated, duration_ms: durationMs },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
