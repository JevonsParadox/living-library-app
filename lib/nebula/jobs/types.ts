import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";

export type JobType = "metadata" | "cover" | "embedding" | "coords" | "paraphrase";

export interface Job {
  id: string;
  work_id: string | null;
  edition_id: string | null;
  job_type: JobType;
  priority: number;
  state: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  payload: Record<string, unknown>;
}

export type HandlerResult = { ok: true } | { ok: false; error: string };

export interface HandlerContext {
  supabase: SupabaseClient;
  openai: OpenAI;
}

export type Handler = (job: Job, ctx: HandlerContext) => Promise<HandlerResult>;
