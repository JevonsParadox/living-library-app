/**
 * Per-book coordinate refinement. Applies the same feature -> axis mapping as
 * scripts/nebula/refine-coordinates.ts but only for this one book — never
 * touches any other book's coordinates (preserves galaxy visual stability).
 *
 * Mapping (SPREAD = 0.06):
 *   X: fantasy_scifi_score     (Fantasy <-> Sci-Fi)
 *   Y: softness_hardness_score (Soft <-> Hard)
 *   Z: intimacy_epic_score     (Intimate <-> Epic)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Handler } from "./types";

const SPREAD = 0.06;

export const handleCoords: Handler = async (job, ctx) => {
  if (!job.work_id) return { ok: false, error: "coords job missing work_id" };

  const { data: feat } = await ctx.supabase
    .from("nb_book_features")
    .select("fantasy_scifi_score, softness_hardness_score, intimacy_epic_score")
    .eq("book_id", job.work_id)
    .maybeSingle<{
      fantasy_scifi_score: number;
      softness_hardness_score: number;
      intimacy_epic_score: number;
    }>();
  if (!feat) {
    // No feature scores yet — seeded coords are still valid; nothing to refine.
    // Return ok so the job completes instead of retry-cycling.
    await markStatus(ctx.supabase, job.work_id, "seeded");
    return { ok: true };
  }

  const { data: coord } = await ctx.supabase
    .from("nb_book_coordinates")
    .select("region_id")
    .eq("book_id", job.work_id)
    .maybeSingle<{ region_id: string | null }>();
  if (!coord?.region_id) {
    return { ok: false, error: "book has no region anchor; can't refine" };
  }

  const { data: region } = await ctx.supabase
    .from("nb_regions")
    .select("anchor_x, anchor_y, anchor_z")
    .eq("id", coord.region_id)
    .single<{ anchor_x: number; anchor_y: number; anchor_z: number }>();
  if (!region) return { ok: false, error: "region not found" };

  const nextX = region.anchor_x + SPREAD * feat.fantasy_scifi_score;
  const nextY = region.anchor_y + SPREAD * feat.softness_hardness_score;
  const nextZ = region.anchor_z + SPREAD * feat.intimacy_epic_score;

  const { error } = await ctx.supabase
    .from("nb_book_coordinates")
    .update({ x: nextX, y: nextY, z: nextZ })
    .eq("book_id", job.work_id);
  if (error) return { ok: false, error: `update coords failed: ${error.message}` };

  await markStatus(ctx.supabase, job.work_id, "refined");
  return { ok: true };
};

async function markStatus(
  supabase: SupabaseClient,
  workId: string,
  status: "refined" | "seeded" | "stale",
): Promise<void> {
  await supabase.from("nb_enrichment_status").upsert({
    work_id: workId,
    coords_status: status,
    coords_last_refined_at: status === "refined" ? new Date().toISOString() : undefined,
  });
}

export { handleCoords as default };
