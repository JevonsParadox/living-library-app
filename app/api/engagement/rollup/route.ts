/**
 * POST /api/engagement/rollup
 *
 * Vercel cron target. Runs the nb_rollup_engagement RPC (90-day window) and
 * updates nb_books.engagement_score.
 *
 * Not functional until the app is deployed. Callable locally for manual tests.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const provided = request.headers.get("x-cron-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc("nb_rollup_engagement", { p_window_days: 90 });
  const durationMs = Date.now() - startedAt;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message, durationMs }, { status: 500 });
  }
  const rows = Array.isArray(data) ? data : [data];
  const rowsUpdated = Number(rows?.[0]?.rows_updated ?? 0);
  return NextResponse.json({ ok: true, rowsUpdated, durationMs });
}
