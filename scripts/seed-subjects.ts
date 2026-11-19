/**
 * Seed script: Fetches subjects for existing books from Open Library
 * and creates subjects + belongs_to edges.
 *
 * Usage: npx tsx scripts/seed-subjects.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Common subjects to seed — mapped from Open Library categories
const SUBJECT_NAMES = [
  "Fiction",
  "Science Fiction",
  "Fantasy",
  "Mystery",
  "Romance",
  "History",
  "Science",
  "Philosophy",
  "Biography",
  "Psychology",
  "Economics",
  "Poetry",
  "Art",
  "Music",
  "Travel",
  "Cooking",
  "Mathematics",
  "Technology",
  "Politics",
  "Religion",
  "Education",
  "Horror",
  "Thriller",
  "Adventure",
  "Classic Literature",
  "Young Adult",
  "Self Help",
  "Business",
  "Nature",
  "Sociology",
];

// Theme names — more specific ideas extracted from subjects
const THEME_NAMES = [
  "dystopia",
  "time travel",
  "artificial intelligence",
  "identity",
  "colonialism",
  "revolution",
  "consciousness",
  "evolution",
  "mortality",
  "love and loss",
  "power and corruption",
  "freedom",
  "memory",
  "solitude",
  "human nature",
  "justice",
  "survival",
  "transformation",
  "faith and doubt",
  "creativity",
];

async function seed() {
  console.log("Creating subjects...");

  const subjectRows = SUBJECT_NAMES.map((name) => ({ name }));
  const { data: subjects, error: subErr } = await supabase
    .from("subjects")
    .upsert(subjectRows, { onConflict: "name", ignoreDuplicates: true })
    .select("id, name");

  if (subErr) {
    console.error("Subject insert error:", subErr.message);
    // Fetch existing
    const { data: existing } = await supabase.from("subjects").select("id, name");
    if (!existing || existing.length === 0) {
      console.error("Failed to create or fetch subjects");
      return;
    }
  }

  const { data: allSubjects } = await supabase.from("subjects").select("id, name");
  const subjectMap = new Map((allSubjects ?? []).map((s) => [s.name, s.id]));
  console.log(`Subjects ready: ${subjectMap.size}`);

  console.log("Creating themes...");

  const themeRows = THEME_NAMES.map((name) => ({ name }));
  await supabase
    .from("themes")
    .upsert(themeRows, { onConflict: "name", ignoreDuplicates: true });

  const { data: allThemes } = await supabase.from("themes").select("id, name");
  const themeMap = new Map((allThemes ?? []).map((t) => [t.name, t.id]));
  console.log(`Themes ready: ${themeMap.size}`);

  // Fetch all books
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author");

  if (!books || books.length === 0) {
    console.log("No books found");
    return;
  }

  console.log(`Assigning subjects to ${books.length} books...`);

  // Assign 1-3 random subjects per book for variety
  const belongsToEdges: {
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    edge_type: string;
  }[] = [];

  const subjectIds = [...subjectMap.values()];
  const subjectNames = [...subjectMap.keys()];

  for (const book of books) {
    const count = 1 + Math.floor(Math.random() * 3); // 1-3 subjects
    const chosen = new Set<number>();
    while (chosen.size < count) {
      chosen.add(Math.floor(Math.random() * subjectIds.length));
    }
    for (const idx of chosen) {
      belongsToEdges.push({
        source_type: "book",
        source_id: book.id,
        target_type: "subject",
        target_id: subjectIds[idx],
        edge_type: "belongs_to",
      });
    }
  }

  // Insert belongs_to edges in batches
  for (let i = 0; i < belongsToEdges.length; i += 100) {
    const batch = belongsToEdges.slice(i, i + 100);
    await supabase.from("edges").upsert(batch, {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
    process.stdout.write(
      `  belongs_to edges: ${Math.min(i + 100, belongsToEdges.length)}\r`
    );
  }
  console.log(`\nCreated ${belongsToEdges.length} belongs_to edges.`);

  // Assign 1-2 random themes per book
  console.log("Assigning themes to books...");

  const linkedToEdges: typeof belongsToEdges = [];
  const themeIds = [...themeMap.values()];

  for (const book of books) {
    const count = 1 + Math.floor(Math.random() * 2); // 1-2 themes
    const chosen = new Set<number>();
    while (chosen.size < count) {
      chosen.add(Math.floor(Math.random() * themeIds.length));
    }
    for (const idx of chosen) {
      linkedToEdges.push({
        source_type: "book",
        source_id: book.id,
        target_type: "theme",
        target_id: themeIds[idx],
        edge_type: "linked_to",
      });
    }
  }

  for (let i = 0; i < linkedToEdges.length; i += 100) {
    const batch = linkedToEdges.slice(i, i + 100);
    await supabase.from("edges").upsert(batch, {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
    process.stdout.write(
      `  linked_to edges: ${Math.min(i + 100, linkedToEdges.length)}\r`
    );
  }
  console.log(`\nCreated ${linkedToEdges.length} linked_to edges.`);

  console.log("\nDone! Subjects and themes seeded.");
}

seed().catch(console.error);
