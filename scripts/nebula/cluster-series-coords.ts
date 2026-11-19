/**
 * Nebula Block 7: Tighten series book coordinates
 *
 * Repositions books in the same series to cluster tightly around their centroid.
 * This makes series visually identifiable as local groups within regions.
 *
 * Usage: npx tsx scripts/nebula/cluster-series-coords.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CLUSTER_RADIUS = 0.03; // how tight the series cluster is

async function run() {
  console.log("Fetching series with books...");

  // Get all books with series_id and coordinates
  const { data: books } = await supabase
    .from("nb_books")
    .select("id, series_id, series_order")
    .not("series_id", "is", null);

  const { data: coords } = await supabase
    .from("nb_book_coordinates")
    .select("book_id, x, y, z");

  if (!books || !coords) {
    console.error("Failed to fetch data");
    return;
  }

  const coordMap = new Map(coords.map((c) => [c.book_id, { x: Number(c.x), y: Number(c.y), z: Number(c.z) }]));

  // Group books by series
  const seriesBooks = new Map<string, Array<{ id: string; order: number | null; x: number; y: number; z: number }>>();
  for (const book of books) {
    if (!book.series_id) continue;
    const coord = coordMap.get(book.id);
    if (!coord) continue;

    const existing = seriesBooks.get(book.series_id) ?? [];
    existing.push({ id: book.id, order: book.series_order ? Number(book.series_order) : null, ...coord });
    seriesBooks.set(book.series_id, existing);
  }

  console.log(`Found ${seriesBooks.size} series to cluster`);

  let updated = 0;
  for (const [seriesId, sBooks] of seriesBooks) {
    if (sBooks.length < 2) continue;

    // Compute centroid
    let cx = 0, cy = 0, cz = 0;
    for (const b of sBooks) { cx += b.x; cy += b.y; cz += b.z; }
    cx /= sBooks.length; cy /= sBooks.length; cz /= sBooks.length;

    // Sort by series_order if available
    sBooks.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    // Reposition in a small sphere around centroid
    for (let i = 0; i < sBooks.length; i++) {
      const book = sBooks[i];
      const angle = (2 * Math.PI * i) / sBooks.length;
      const layerOffset = i * 0.005; // slight vertical spread

      const newX = cx + CLUSTER_RADIUS * Math.cos(angle);
      const newY = cy + layerOffset;
      const newZ = cz + CLUSTER_RADIUS * Math.sin(angle);

      await supabase
        .from("nb_book_coordinates")
        .update({ x: newX, y: newY, z: newZ })
        .eq("book_id", book.id);

      updated++;
    }
  }

  console.log(`Updated ${updated} book coordinates`);
}

run().catch(console.error);
