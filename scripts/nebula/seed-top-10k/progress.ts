import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../../.env.local") });

async function main() {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const [books, statuses, jobs, editions, authors, series] = await Promise.all([
    s.from("nb_books").select("id", { count: "exact", head: true }),
    s.from("nb_enrichment_status").select("work_id", { count: "exact", head: true }),
    s.from("nb_enrichment_jobs").select("id", { count: "exact", head: true }),
    s.from("nb_editions").select("id", { count: "exact", head: true }),
    s.from("nb_authors").select("id", { count: "exact", head: true }),
    s.from("nb_series").select("id", { count: "exact", head: true }),
  ]);
  console.log(JSON.stringify({
    books: books.count,
    enrichment_status: statuses.count,
    jobs: jobs.count,
    editions: editions.count,
    authors: authors.count,
    series: series.count,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
