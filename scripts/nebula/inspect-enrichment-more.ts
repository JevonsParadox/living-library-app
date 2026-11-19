/**
 * Deeper inspection: source_records, tags, embeddings for a work.
 * Usage: npx tsx scripts/nebula/inspect-enrichment-more.ts <work_id>
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
  const workId = process.argv[2];
  if (!workId) {
    console.error("usage: inspect-enrichment-more.ts <work_id>");
    process.exit(1);
  }

  const { data: sources } = await supabase
    .from("nb_source_records")
    .select("provider, provider_record_id, fetched_at")
    .eq("work_id", workId)
    .order("fetched_at", { ascending: false });
  console.log("=== source_records ===");
  console.log(JSON.stringify(sources, null, 2));

  const { data: tags } = await supabase
    .from("nb_book_tags")
    .select("source, tag_type, tag_value")
    .eq("book_id", workId)
    .order("created_at", { ascending: false })
    .limit(20);
  console.log("\n=== tags (top 20) ===");
  console.log(JSON.stringify(tags, null, 2));

  const { data: emb } = await supabase
    .from("nb_book_embeddings")
    .select("book_id, model, input_hash, created_at")
    .eq("book_id", workId)
    .maybeSingle();
  console.log("\n=== embedding ===");
  console.log(JSON.stringify(emb, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
