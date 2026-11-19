/**
 * Refine book coordinates using feature scores.
 *
 * Maps the 3 primary feature dimensions to XYZ offsets within each book's region:
 *   X: fantasy_scifi_score     (Fantasy <-> Sci-Fi)
 *   Y: softness_hardness_score (Soft <-> Hard)
 *   Z: intimacy_epic_score     (Intimate <-> Epic)
 *
 * Run AFTER score-book-features.ts and BEFORE cluster-series-coords.ts.
 *
 * Usage: npx tsx scripts/nebula/refine-coordinates.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Max offset per axis from region anchor.
// Keeps books within their region's visual territory.
const SPREAD = 0.06;

interface Region {
  id: string;
  name: string;
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
}

interface Features {
  book_id: string;
  fantasy_scifi_score: number;
  softness_hardness_score: number;
  intimacy_epic_score: number;
}

interface Coord {
  book_id: string;
  region_id: string;
}

async function main() {
  console.log("Fetching data...");

  // Fetch regions (small table, no pagination needed)
  const { data: regionsData } = await supabase.from("nb_regions").select("id, name, anchor_x, anchor_y, anchor_z");
  const regions: Region[] = regionsData ?? [];

  // Fetch features (paginated)
  const features: Features[] = [];
  let fOff = 0;
  while (true) {
    const { data } = await supabase
      .from("nb_book_features")
      .select("book_id, fantasy_scifi_score, softness_hardness_score, intimacy_epic_score")
      .range(fOff, fOff + 999);
    if (!data || data.length === 0) break;
    features.push(...data);
    fOff += data.length;
    if (data.length < 1000) break;
  }

  // Fetch coordinates (paginated)
  const coords: Coord[] = [];
  let cOff = 0;
  while (true) {
    const { data } = await supabase
      .from("nb_book_coordinates")
      .select("book_id, region_id")
      .range(cOff, cOff + 999);
    if (!data || data.length === 0) break;
    coords.push(...data);
    cOff += data.length;
    if (data.length < 1000) break;
  }

  if (features.length === 0) {
    console.log("No features found — run score-book-features.ts first.");
    return;
  }

  // Build lookup maps
  const regionMap = new Map(regions.map((r) => [r.id, r]));
  const coordRegionMap = new Map(coords.map((c) => [c.book_id, c.region_id]));

  console.log(`${features.length} books with features, ${regions.length} regions, ${coords.length} coordinates`);

  // Compute refined coordinates
  const updates: { book_id: string; x: number; y: number; z: number }[] = [];
  let skipped = 0;

  for (const feat of features) {
    const regionId = coordRegionMap.get(feat.book_id);
    if (!regionId) { skipped++; continue; }

    const region = regionMap.get(regionId);
    if (!region) { skipped++; continue; }

    // Map 0-1 scores to offsets: score 0.5 → 0 offset, 0 → -SPREAD, 1 → +SPREAD
    const xOffset = (feat.fantasy_scifi_score - 0.5) * 2 * SPREAD;
    const yOffset = (feat.softness_hardness_score - 0.5) * 2 * SPREAD;
    const zOffset = (feat.intimacy_epic_score - 0.5) * 2 * SPREAD;

    updates.push({
      book_id: feat.book_id,
      x: region.anchor_x + xOffset,
      y: region.anchor_y + yOffset,
      z: region.anchor_z + zOffset,
    });
  }

  console.log(`${updates.length} coordinates to update, ${skipped} skipped (no region mapping)`);

  // Batch update coordinates
  let updated = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);

    for (const u of batch) {
      const { error } = await supabase
        .from("nb_book_coordinates")
        .update({ x: u.x, y: u.y, z: u.z })
        .eq("book_id", u.book_id);

      if (error) {
        console.error(`  Error updating ${u.book_id}:`, error.message);
        continue;
      }
      updated++;
    }

    if ((i + 100) % 500 === 0 || i + 100 >= updates.length) {
      console.log(`  Updated ${Math.min(updated, updates.length)}/${updates.length}`);
    }
  }

  console.log(`\nDone! Updated ${updated} book coordinates.`);
  console.log("Next: run cluster-series-coords.ts to re-cluster series books.");
}

main().catch(console.error);
