/**
 * POST /api/enrichment/tick
 *
 * Vercel cron target. Runs one worker pass with a tight deadline.
 * Protected by a shared secret (CRON_SECRET env var).
 * Not functional until the app is deployed to Vercel; callable locally for manual tests.
 */

import { NextResponse } from "next/server";
import { runWorker } from "@/lib/nebula/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const provided = request.headers.get("x-cron-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const stats = await runWorker({
      once: true,
      maxRuntimeSeconds: 55,
      concurrency: 5,
    });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
