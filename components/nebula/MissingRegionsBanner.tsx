"use client";

/**
 * Dev-only diagnostic banner. Mounts on every Nebula page; surfaces only
 * when the catalog reads silently fail and the universe arrives empty.
 *
 * Background: `lib/supabase-server.ts` intentionally falls back to an
 * anon Supabase client when the Clerk "supabase" JWT template can't be
 * fetched, because a transient Clerk hiccup shouldn't take the universe
 * down for legitimate readers. The cost is that a *persistent* misconfig
 * (e.g. JWT template not set up in Clerk) also degrades silently — RLS
 * denies anon's SELECT on `nb_regions`, regions arrives as `[]`, and
 * "Your constellation" + every region-derived label reads "Unknown"
 * with no clear cause. We chased this twice before nailing the root
 * cause; this banner makes that case impossible to miss in dev.
 *
 * Production keeps the silent fallback by design — a real Clerk API
 * blip shouldn't paint a scary banner over real users' sessions. See
 * ADR-011.
 */

import { useNebula } from "@/lib/nebula/nebula-context";
import { AlertTriangle } from "lucide-react";

export function MissingRegionsBanner() {
  const { regions } = useNebula();

  if (process.env.NODE_ENV === "production") return null;
  if (regions.length > 0) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 max-w-xl pointer-events-auto">
      <div className="bg-amber-500/15 border border-amber-500/40 backdrop-blur-md rounded-lg px-3 py-2 text-amber-100 text-[11px] flex items-start gap-2 shadow-lg">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-300" />
        <div className="flex-1 leading-snug">
          <p className="font-medium mb-0.5">No regions loaded — catalog reads are returning empty.</p>
          <p className="text-amber-100/70">
            Almost always: Clerk&apos;s JWT template named{" "}
            <code className="text-amber-200 bg-amber-500/10 px-1 rounded">supabase</code>{" "}
            is missing or misconfigured. Check Clerk Dashboard → Configure → JWT
            Templates. Full fix path:{" "}
            <code className="text-amber-200 bg-amber-500/10 px-1 rounded">docs/decisions/0011-fail-loud-in-dev.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
