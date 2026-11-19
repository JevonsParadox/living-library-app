"use server";

import { auth } from "@clerk/nextjs/server";
import { createAuthClient } from "@/lib/supabase-server";
import { seedReadingPath } from "./seed-reading-path";
import { enrichBookMetadata, seedComprehensiveRecs } from "./enrich-library";

/**
 * Check if the library needs seeding/enrichment and run if so.
 * Returns what was done, or null if nothing needed.
 */
export async function autoSeedIfNeeded(): Promise<{
  needed: boolean;
  readDatesFixed?: number;
  enriched?: number;
  recsCreated?: number;
} | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const supabase = await createAuthClient();

  // Check if books exist at all
  const { data: userEdges } = await supabase
    .from("edges")
    .select("target_id")
    .eq("source_type", "user")
    .eq("target_type", "book")
    .in("edge_type", ["owns", "reading", "read", "wishlist"])
    .limit(1);

  if (!userEdges || userEdges.length === 0) return { needed: false };

  let didWork = false;
  let readDatesFixed = 0;
  let enriched = 0;
  let recsCreated = 0;

  // 1. Fix read dates if needed (all same date)
  const { data: readEdges } = await supabase
    .from("edges")
    .select("metadata")
    .eq("source_type", "user")
    .eq("target_type", "book")
    .eq("edge_type", "read")
    .limit(5);

  if (readEdges && readEdges.length > 0) {
    const allSameDate = readEdges.every((e) => {
      const meta = e.metadata as { read_at?: string } | null;
      return !meta?.read_at;
    });
    if (allSameDate) {
      const result = await seedReadingPath();
      readDatesFixed = result.updated;
      didWork = true;
    }
  }

  // 2. Enrich covers if many are missing
  const { data: bookSample } = await supabase
    .from("books")
    .select("cover_url")
    .is("cover_url", null)
    .limit(5);

  if (bookSample && bookSample.length >= 3) {
    const result = await enrichBookMetadata();
    enriched = result.enriched;
    didWork = true;
  }

  // 3. Seed recommendations if few exist
  const { data: recCount } = await supabase
    .from("edges")
    .select("id")
    .eq("edge_type", "recommended")
    .limit(1);

  if (!recCount || recCount.length === 0) {
    const result = await seedComprehensiveRecs();
    recsCreated = result.recsCreated;
    didWork = true;
  }

  return { needed: didWork, readDatesFixed, enriched, recsCreated };
}
