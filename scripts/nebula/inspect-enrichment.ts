/**
 * One-shot diagnostic: dumps the latest enrichment job + associated book state.
 * Use after a worker run to understand success / failure.
 *
 * Usage: npx tsx scripts/nebula/inspect-enrichment.ts [work_id]
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
  const workIdArg = process.argv[2];

  let jobQuery = supabase
    .from("nb_enrichment_jobs")
    .select("id, work_id, job_type, state, attempts, max_attempts, last_error, scheduled_for, started_at, finished_at, last_heartbeat")
    .order("created_at", { ascending: false })
    .limit(5);
  if (workIdArg) jobQuery = jobQuery.eq("work_id", workIdArg);

  const { data: jobs } = await jobQuery;
  console.log("=== recent jobs ===");
  console.log(JSON.stringify(jobs, null, 2));

  const workId = workIdArg ?? jobs?.[0]?.work_id;
  if (!workId) {
    console.log("no work_id to inspect");
    return;
  }

  const { data: book } = await supabase
    .from("nb_books")
    .select("id, title, description, short_description, cover_image_url, isbn_13, isbn_10, external_ids, primary_author_id")
    .eq("id", workId)
    .single();
  console.log("\n=== nb_books ===");
  console.log(JSON.stringify(book, null, 2));

  if (book?.primary_author_id) {
    const { data: author } = await supabase
      .from("nb_authors")
      .select("name")
      .eq("id", book.primary_author_id)
      .single();
    console.log("\n=== author ===");
    console.log(JSON.stringify(author, null, 2));
  }

  const { data: status } = await supabase
    .from("nb_enrichment_status")
    .select("*")
    .eq("work_id", workId)
    .maybeSingle();
  console.log("\n=== enrichment_status ===");
  console.log(JSON.stringify(status, null, 2));

  const { data: sources } = await supabase
    .from("nb_source_records")
    .select("provider, provider_record_id, fetched_at")
    .eq("work_id", workId);
  console.log("\n=== source_records ===");
  console.log(JSON.stringify(sources, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
