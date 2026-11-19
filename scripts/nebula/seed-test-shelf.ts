/**
 * Wipe the admin user's nb_user_books rows and re-seed with a curated
 * 30-book test shelf. Distributes books across regions and library states
 * so we can eyeball Phase G illumination + D4 region planet brightness
 * effects without depending on the user's real reading history.
 *
 * Distribution (regions ranked by catalog popularity_score sum):
 *   Heavy 1   10 books  (5 read · 2 reading · 3 wishlist)
 *   Heavy 2    6 books  (3 read · 1 reading · 2 next_up)
 *   Medium 3   5 books  (2 read · 3 on_shelf)
 *   Medium 4   4 books  (1 read · 2 on_shelf · 1 wishlist)
 *   Small  5   3 books  (1 read · 2 wishlist)
 *   Small  6   2 books  (1 reading · 1 wishlist)
 *   ---
 *   Total     30 books · 12 read · 4 reading · 3 next_up · 5 on_shelf · 6 wishlist
 *
 * Remaining ~8 regions get zero books — exercises D4's faint-outline state.
 *
 * Within each chosen region, top books are picked by popularity_score (the
 * most recognisable titles, makes visual debugging easier).
 *
 * Usage:
 *   npx tsx scripts/nebula/seed-test-shelf.ts --dry-run     # preview only
 *   npx tsx scripts/nebula/seed-test-shelf.ts --confirm     # actually wipe + insert
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ---------- Args ----------

interface Args {
  dryRun: boolean;
  confirm: boolean;
  userId: string;
}

function parseArgs(): Args {
  const args: Args = {
    dryRun: false,
    confirm: false,
    userId: process.env.ADMIN_USER_IDS?.split(",")[0]?.trim() ?? "",
  };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--confirm") args.confirm = true;
    else if (a.startsWith("--user=")) args.userId = a.slice("--user=".length);
  }
  if (!args.userId) {
    console.error("Missing user id. Set ADMIN_USER_IDS in .env.local or pass --user=<clerk_id>.");
    process.exit(1);
  }
  if (!args.dryRun && !args.confirm) {
    console.error("Refusing to run without --dry-run or --confirm. Aborting.");
    process.exit(1);
  }
  return args;
}

// ---------- Distribution spec ----------

type ReadStatus = "unread" | "reading" | "read" | "next_up";
type Ownership = "owned" | "wishlist";

interface SeedRow {
  ownership: Ownership;
  status: ReadStatus;
  read_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

function makeStateRow(state: "read" | "reading" | "next_up" | "on_shelf" | "wishlist"): SeedRow {
  const now = new Date();
  const monthsAgo = (n: number) => new Date(now.getTime() - n * 30 * 24 * 3600 * 1000).toISOString();
  switch (state) {
    case "read":
      return {
        ownership: "owned",
        status: "read",
        read_at: monthsAgo(Math.floor(Math.random() * 12) + 1),
        started_at: null,
        finished_at: null,
      };
    case "reading":
      return {
        ownership: "owned",
        status: "reading",
        read_at: null,
        started_at: monthsAgo(1),
        finished_at: null,
      };
    case "next_up":
      return {
        ownership: "owned",
        status: "next_up",
        read_at: null,
        started_at: null,
        finished_at: null,
      };
    case "on_shelf":
      return {
        ownership: "owned",
        status: "unread",
        read_at: null,
        started_at: null,
        finished_at: null,
      };
    case "wishlist":
      return {
        ownership: "wishlist",
        status: "unread",
        read_at: null,
        started_at: null,
        finished_at: null,
      };
  }
}

interface RegionSlot {
  rank: "heavy_1" | "heavy_2" | "medium_3" | "medium_4" | "small_5" | "small_6";
  count: number;
  states: Array<"read" | "reading" | "next_up" | "on_shelf" | "wishlist">;
}

const SLOTS: RegionSlot[] = [
  { rank: "heavy_1",  count: 10, states: ["read","read","read","read","read","reading","reading","wishlist","wishlist","wishlist"] },
  { rank: "heavy_2",  count:  6, states: ["read","read","read","reading","next_up","next_up"] },
  { rank: "medium_3", count:  5, states: ["read","read","on_shelf","on_shelf","on_shelf"] },
  { rank: "medium_4", count:  4, states: ["read","on_shelf","on_shelf","wishlist"] },
  { rank: "small_5",  count:  3, states: ["read","wishlist","wishlist"] },
  { rank: "small_6",  count:  2, states: ["reading","wishlist"] },
];

// ---------- Main ----------

async function main() {
  const args = parseArgs();
  console.log(`User: ${args.userId.slice(0, 12)}…`);
  console.log(`Mode: ${args.dryRun ? "DRY RUN (no changes)" : "CONFIRM (will wipe + insert)"}`);
  console.log("");

  // Current shelf snapshot
  const { count: existingCount, error: countErr } = await supabase
    .from("nb_user_books")
    .select("*", { count: "exact", head: true })
    .eq("user_id", args.userId);
  if (countErr) {
    console.error("Failed to read current shelf:", countErr.message);
    process.exit(1);
  }
  console.log(`Current shelf: ${existingCount ?? 0} books`);
  console.log("");

  // Region popularity ranking — sum popularity_score per region.
  const { data: bookRows, error: booksErr } = await supabase
    .from("nb_books")
    .select("id, title, popularity_score")
    .order("popularity_score", { ascending: false })
    .limit(2000);
  if (booksErr || !bookRows) {
    console.error("Failed to fetch books:", booksErr?.message);
    process.exit(1);
  }

  const { data: coordRows, error: coordsErr } = await supabase
    .from("nb_book_coordinates")
    .select("book_id, region_id");
  if (coordsErr || !coordRows) {
    console.error("Failed to fetch coordinates:", coordsErr?.message);
    process.exit(1);
  }

  const { data: regionRows, error: regionsErr } = await supabase
    .from("nb_regions")
    .select("id, name, slug");
  if (regionsErr || !regionRows) {
    console.error("Failed to fetch regions:", regionsErr?.message);
    process.exit(1);
  }

  const coordByBook = new Map<string, string | null>();
  for (const c of coordRows) coordByBook.set(c.book_id as string, c.region_id as string | null);
  const regionById = new Map<string, { name: string; slug: string }>();
  for (const r of regionRows) regionById.set(r.id as string, { name: r.name as string, slug: r.slug as string });

  // Bucket the top 2000 books by region; carry popularity for sorting.
  const booksByRegion = new Map<string, Array<{ id: string; title: string; pop: number }>>();
  for (const b of bookRows) {
    const rid = coordByBook.get(b.id as string);
    if (!rid) continue;
    if (!regionById.has(rid)) continue;
    const arr = booksByRegion.get(rid) ?? [];
    arr.push({ id: b.id as string, title: b.title as string, pop: Number(b.popularity_score) });
    booksByRegion.set(rid, arr);
  }

  // Rank regions by total popularity_score sum (top books only — proxy for
  // "biggest genre" weighted toward popular titles).
  const ranked = Array.from(booksByRegion.entries())
    .map(([rid, books]) => ({
      regionId: rid,
      name: regionById.get(rid)!.name,
      slug: regionById.get(rid)!.slug,
      totalPop: books.reduce((s, b) => s + b.pop, 0),
      books,
    }))
    .sort((a, b) => b.totalPop - a.totalPop);

  if (ranked.length < 6) {
    console.error(`Only ${ranked.length} regions populated; need at least 6.`);
    process.exit(1);
  }

  console.log("Top 8 regions by catalog popularity sum (first 6 will be used):");
  for (let i = 0; i < Math.min(8, ranked.length); i++) {
    const r = ranked[i];
    const used = i < SLOTS.length ? "  ← USE" : "";
    console.log(`  ${(i + 1).toString().padStart(2)}. ${r.name.padEnd(40)} ${r.books.length} books${used}`);
  }
  console.log("");

  // Pick books per slot — top of region by popularity.
  const seedRows: Array<{ book_id: string; title: string; region_name: string; state: string; row: SeedRow }> = [];
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i];
    const region = ranked[i];
    const top = region.books.slice(0, slot.count);
    if (top.length < slot.count) {
      console.warn(`Region ${region.name} has only ${top.length} books, expected ${slot.count}`);
    }
    for (let j = 0; j < top.length; j++) {
      const state = slot.states[j];
      seedRows.push({
        book_id: top[j].id,
        title: top[j].title,
        region_name: region.name,
        state,
        row: makeStateRow(state),
      });
    }
  }

  console.log(`Selected ${seedRows.length} books to insert:`);
  for (const r of seedRows) {
    console.log(`  [${r.state.padEnd(8)}] ${r.title.padEnd(40)} (${r.region_name})`);
  }
  console.log("");

  if (args.dryRun) {
    console.log("DRY RUN — nothing changed. Re-run with --confirm to apply.");
    process.exit(0);
  }

  // Destructive: wipe all rows for this user.
  console.log(`Deleting ${existingCount ?? 0} existing rows for user…`);
  const { error: delErr } = await supabase
    .from("nb_user_books")
    .delete()
    .eq("user_id", args.userId);
  if (delErr) {
    console.error("Delete failed:", delErr.message);
    process.exit(1);
  }

  // Insert.
  const insertPayload = seedRows.map((r) => ({
    user_id: args.userId,
    book_id: r.book_id,
    ownership_type: r.row.ownership,
    read_status: r.row.status,
    rating: null,
    started_at: r.row.started_at,
    finished_at: r.row.finished_at,
    read_at: r.row.read_at,
  }));
  const { error: insErr } = await supabase.from("nb_user_books").insert(insertPayload);
  if (insErr) {
    console.error("Insert failed:", insErr.message);
    process.exit(1);
  }

  // Verify.
  const { count: newCount } = await supabase
    .from("nb_user_books")
    .select("*", { count: "exact", head: true })
    .eq("user_id", args.userId);
  console.log(`Inserted ${seedRows.length} books. Shelf now: ${newCount ?? 0} books.`);
  console.log("Hard-refresh /nebula to see the new state.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
