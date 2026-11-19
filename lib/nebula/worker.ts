/**
 * Core enrichment worker loop. Shared between the CLI script
 * (scripts/nebula/run-enrichment-worker.ts) and the Vercel-cron-triggered
 * API route (app/api/enrichment/tick/route.ts).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { handleMetadata } from "./jobs/metadata";
import { handleCover } from "./jobs/cover";
import { handleEmbedding } from "./jobs/embedding";
import { handleCoords } from "./jobs/coords";
import { handleParaphrase } from "./jobs/paraphrase";
import type { Handler, Job, JobType } from "./jobs/types";

const HANDLERS: Record<JobType, Handler> = {
  metadata: handleMetadata,
  cover: handleCover,
  embedding: handleEmbedding,
  coords: handleCoords,
  paraphrase: handleParaphrase,
};

export interface WorkerStats {
  claimed: number;
  completed: number;
  failed: number;
  deferred: number;
  dead: number;
}

export interface WorkerOptions {
  once?: boolean;
  loop?: boolean;
  maxRuntimeSeconds?: number;
  concurrency?: number;
  types?: JobType[];
}

export async function runWorker(opts: WorkerOptions = {}): Promise<WorkerStats> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing Supabase env vars");
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const deadline = Date.now() + (opts.maxRuntimeSeconds ?? 55) * 1000;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const once = opts.once ?? !opts.loop;
  const stats: WorkerStats = { claimed: 0, completed: 0, failed: 0, deferred: 0, dead: 0 };

  // Reclaim jobs stuck in 'running' with a stale heartbeat. Without this, any
  // worker that exited mid-flight (deadline hit, crash) leaves jobs wedged
  // and the RPC skips them forever via FOR UPDATE SKIP LOCKED.
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabase
    .from("nb_enrichment_jobs")
    .update({ state: "pending", started_at: null, last_heartbeat: null })
    .eq("state", "running")
    .lt("last_heartbeat", staleCutoff);

  // Enqueue metadata refreshes for works whose next_refresh_at has passed.
  // Closes the popular-path-promotion loop — works bumped by the nightly
  // promotion script actually re-run through the enrichment pipeline.
  await enqueueDueRefreshes(supabase);

  while (Date.now() < deadline) {
    const claimLimit = concurrency * 4;
    const { data: claimed, error: claimErr } = await supabase.rpc("nb_claim_enrichment_jobs", {
      p_limit: claimLimit,
    });
    if (claimErr) {
      console.error("claim rpc error:", claimErr.message);
      break;
    }
    const jobs = (claimed ?? []) as Job[];

    const accepted: Job[] = [];
    for (const j of jobs) {
      if (opts.types && !opts.types.includes(j.job_type)) {
        await supabase
          .from("nb_enrichment_jobs")
          .update({ state: "pending", started_at: null, last_heartbeat: null })
          .eq("id", j.id);
        continue;
      }
      accepted.push(j);
    }
    stats.claimed += accepted.length;

    if (accepted.length === 0) {
      if (once) break;
      await sleep(2000);
      continue;
    }

    for (let i = 0; i < accepted.length; i += concurrency) {
      if (Date.now() >= deadline) break;
      const batch = accepted.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (job) => {
          const outcome = await runOne(supabase, openai, job);
          stats.completed += outcome.completed;
          stats.failed += outcome.failed;
          stats.deferred += outcome.deferred;
          stats.dead += outcome.dead;
        }),
      );
    }

    if (once) break;
  }

  return stats;
}

interface OneOutcome {
  completed: number;
  failed: number;
  deferred: number;
  dead: number;
}

async function runOne(
  supabase: SupabaseClient,
  openai: OpenAI,
  job: Job,
): Promise<OneOutcome> {
  const handler = HANDLERS[job.job_type];
  if (!handler) {
    await supabase
      .from("nb_enrichment_jobs")
      .update({
        state: "dead",
        last_error: `no handler for ${job.job_type}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { completed: 0, failed: 0, deferred: 0, dead: 1 };
  }

  try {
    const result = await handler(job, { supabase, openai });
    if (result.ok) {
      await supabase
        .from("nb_enrichment_jobs")
        .update({
          state: "completed",
          finished_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id);
      return { completed: 1, failed: 0, deferred: 0, dead: 0 };
    }
    return await failOrDefer(supabase, job, result.error);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await failOrDefer(supabase, job, msg);
  }
}

async function failOrDefer(
  supabase: SupabaseClient,
  job: Job,
  error: string,
): Promise<OneOutcome> {
  if (job.attempts >= job.max_attempts) {
    await supabase
      .from("nb_enrichment_jobs")
      .update({ state: "dead", last_error: error, finished_at: new Date().toISOString() })
      .eq("id", job.id);
    return { completed: 0, failed: 0, deferred: 0, dead: 1 };
  }
  const backoffMinutes = Math.min(job.attempts, 5) * 2;
  const nextRun = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
  await supabase
    .from("nb_enrichment_jobs")
    .update({
      state: "pending",
      last_error: error,
      scheduled_for: nextRun,
      started_at: null,
      last_heartbeat: null,
    })
    .eq("id", job.id);
  return { completed: 0, failed: 1, deferred: 1, dead: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Find works whose metadata_next_refresh_at has passed and that have no
 * active metadata job, then enqueue one. Keeps the popular-path-promotion
 * loop honest: the nightly promotion sets metadata_next_refresh_at earlier
 * for hot works; this turns that into actual queued work.
 */
async function enqueueDueRefreshes(supabase: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { data: due } = await supabase
    .from("nb_enrichment_status")
    .select("work_id")
    .lt("metadata_next_refresh_at", now)
    .in("metadata_status", ["enriched", "stale"])
    .limit(500);
  if (!due || due.length === 0) return;

  const workIds = due.map((r) => (r as { work_id: string }).work_id);

  // Skip works that already have an active metadata job (pending or running).
  const { data: active } = await supabase
    .from("nb_enrichment_jobs")
    .select("work_id")
    .eq("job_type", "metadata")
    .in("state", ["pending", "running"])
    .in("work_id", workIds);
  const activeSet = new Set((active ?? []).map((r) => (r as { work_id: string }).work_id));

  const rows = workIds
    .filter((id) => !activeSet.has(id))
    .map((id) => ({ work_id: id, job_type: "metadata", priority: 90 }));
  if (rows.length === 0) return;
  await supabase.from("nb_enrichment_jobs").insert(rows);
}
