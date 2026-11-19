/**
 * Enrichment worker CLI.
 *
 * Flags:
 *   --once                Run one pass then exit. Default.
 *   --loop                Keep running until no jobs remain or the deadline hits.
 *   --max-runtime=<s>     Hard cap in seconds (default 55).
 *   --concurrency=<n>     Parallel handler dispatches (default 5).
 *   --types=a,b,c         Filter to these job types.
 *
 * Usage:
 *   npx tsx scripts/nebula/run-enrichment-worker.ts --once
 *   npx tsx scripts/nebula/run-enrichment-worker.ts --loop --concurrency=3
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

import { runWorker, type WorkerOptions } from "../../lib/nebula/worker";
import type { JobType } from "../../lib/nebula/jobs/types";

function parseFlags(): WorkerOptions {
  const args = process.argv.slice(2);
  const opts: WorkerOptions = {};
  for (const a of args) {
    if (a === "--once") opts.once = true;
    else if (a === "--loop") opts.loop = true;
    else if (a.startsWith("--max-runtime=")) opts.maxRuntimeSeconds = Number(a.split("=")[1]);
    else if (a.startsWith("--concurrency=")) opts.concurrency = Number(a.split("=")[1]);
    else if (a.startsWith("--types=")) {
      opts.types = a.split("=")[1].split(",").filter(Boolean) as JobType[];
    }
  }
  return opts;
}

runWorker(parseFlags())
  .then((stats) => {
    console.log(
      `worker done: claimed=${stats.claimed} completed=${stats.completed} failed=${stats.failed} deferred=${stats.deferred} dead=${stats.dead}`,
    );
    process.exit(stats.dead > 0 ? 2 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
