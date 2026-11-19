/**
 * POST /api/engagement/promote-popular
 *
 * Vercel cron target (daily). For each work with engagement_score above
 * threshold, pulls its metadata_next_refresh_at forward so the enrichment
 * worker re-enriches it sooner than the default 180-day cadence.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_THRESHOLD = 50;
const DEFAULT_INTERVAL_DAYS = 90;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data: popular, error: err1 } = await supabase
    .from("nb_books")
    .select("id")
    .gte("engagement_score", DEFAULT_THRESHOLD);
  if (err1) return NextResponse.json({ ok: false, error: err1.message }, { status: 500 });
  const ids = (popular ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, promoted: 0, candidates: 0 });
  }

  const newRefresh = new Date(
    Date.now() + DEFAULT_INTERVAL_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  const BATCH = 500;
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { data } = await supabase
      .from("nb_enrichment_status")
      .update({ metadata_next_refresh_at: newRefresh })
      .in("work_id", chunk)
      .or(`metadata_next_refresh_at.is.null,metadata_next_refresh_at.gt.${newRefresh}`)
      .select("work_id");
    updated += data?.length ?? 0;
  }

  return NextResponse.json({ ok: true, promoted: updated, candidates: ids.length });
}
