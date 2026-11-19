/**
 * Nebula Block 7: Seed series_sequence edges
 *
 * Creates nb_book_edges rows connecting consecutive books in each series.
 *
 * Usage: npx tsx scripts/nebula/seed-series-edges.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  console.log("Fetching series books...");

  const { data: books } = await supabase
    .from("nb_books")
    .select("id, series_id, series_order")
    .not("series_id", "is", null)
    .order("series_order", { ascending: true });

  if (!books) {
    console.error("Failed to fetch books");
    return;
  }

  // Group by series
  const seriesBooks = new Map<string, Array<{ id: string; order: number }>>();
  for (const book of books) {
    if (!book.series_id || !book.series_order) continue;
    const existing = seriesBooks.get(book.series_id) ?? [];
    existing.push({ id: book.id, order: Number(book.series_order) });
    seriesBooks.set(book.series_id, existing);
  }

  console.log(`Found ${seriesBooks.size} series`);

  let edgesCreated = 0;
  const edges: Array<{ source_book_id: string; target_book_id: string; edge_type: string; score: number; rank: number }> = [];

  for (const [, sBooks] of seriesBooks) {
    if (sBooks.length < 2) continue;
    sBooks.sort((a, b) => a.order - b.order);

    for (let i = 0; i < sBooks.length - 1; i++) {
      edges.push({
        source_book_id: sBooks[i].id,
        target_book_id: sBooks[i + 1].id,
        edge_type: "series_sequence",
        score: 1.0,
        rank: i + 1,
      });
    }
  }

  // Batch insert
  for (let i = 0; i < edges.length; i += 100) {
    const batch = edges.slice(i, i + 100);
    const { error } = await supabase.from("nb_book_edges").upsert(batch, {
      onConflict: "source_book_id,target_book_id,edge_type",
    });
    if (error) console.error(`Batch ${i} error:`, error.message);
    else edgesCreated += batch.length;
  }

  console.log(`Created ${edgesCreated} series_sequence edges`);
}

run().catch(console.error);
