/**
 * Diagnostic: print exactly what the NebulaContext computes for the admin
 * user. Mirrors fetch-nebula-data + computeIllumination so we can see
 * the data the BookCloud actually receives.
 *
 * Run: npx tsx scripts/nebula/inspect-illumination.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const userId = process.env.ADMIN_USER_IDS?.split(",")[0]?.trim();
  if (!userId) {
    console.error("ADMIN_USER_IDS missing");
    process.exit(1);
  }

  // 1) How many shelf rows
  const { data: shelf, error: shelfErr } = await supabase
    .from("nb_user_books")
    .select("book_id, ownership_type, read_status")
    .eq("user_id", userId);
  if (shelfErr) {
    console.error(shelfErr);
    process.exit(1);
  }
  console.log(`nb_user_books for ${userId.slice(0, 12)}…  ${shelf!.length} rows`);
  const byState = new Map<string, number>();
  for (const r of shelf!) {
    const k = `${r.ownership_type}/${r.read_status}`;
    byState.set(k, (byState.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byState) console.log(`   ${k}  ${n}`);
  console.log("");

  // 2) Edge coverage for those shelf books
  const shelfIds = shelf!.map((r) => r.book_id as string);
  const { data: edges } = await supabase
    .from("nb_book_edges")
    .select("source_book_id, target_book_id")
    .in("source_book_id", shelfIds)
    .eq("edge_type", "semantic_similarity")
    .order("rank", { ascending: true });
  const edgesBySource = new Map<string, string[]>();
  for (const e of edges ?? []) {
    const arr = edgesBySource.get(e.source_book_id as string) ?? [];
    arr.push(e.target_book_id as string);
    edgesBySource.set(e.source_book_id as string, arr);
  }
  const sourcesWithEdges = edgesBySource.size;
  console.log(`Sources with semantic edges: ${sourcesWithEdges} / ${shelfIds.length}`);
  console.log(`Sources falling back to spatial: ${shelfIds.length - sourcesWithEdges}`);
  console.log("");

  // 3) Build the illumination set the same way the context does (top-6 per source, dedupe, exclude shelf)
  const shelfSet = new Set(shelfIds);
  const illuminated = new Set<string>();
  for (const sid of shelfIds) {
    const eds = (edgesBySource.get(sid) ?? []).filter((id) => !shelfSet.has(id)).slice(0, 6);
    for (const id of eds) illuminated.add(id);
  }
  console.log(`Illuminated set size (semantic only, excludes spatial fallback): ${illuminated.size}`);
  console.log(`Expected total bright dots in 3D: ${shelfIds.length} shelf + ~${illuminated.size} illuminated = ~${shelfIds.length + illuminated.size}`);
  console.log("");

  // 4) Total books in catalog
  const { count: bookCount } = await supabase
    .from("nb_books")
    .select("*", { count: "exact", head: true });
  console.log(`Total catalog books: ${bookCount}`);
  console.log(`Background tier (everything else): ${(bookCount ?? 0) - shelfIds.length - illuminated.size}`);
}

main().catch(console.error);
