/**
 * Seed script: Fetches ~2000 real books from Open Library and inserts them
 * into Supabase with authors, wrote edges, and owns edges.
 *
 * Usage: npx tsx scripts/seed-books.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = "user_3C4BeJK23LJcypCJ5JI17gfzsLi";

// Use service role to bypass RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SUBJECTS = [
  "fiction",
  "science_fiction",
  "fantasy",
  "mystery",
  "romance",
  "history",
  "science",
  "philosophy",
  "biography",
  "psychology",
  "economics",
  "poetry",
  "art",
  "music",
  "travel",
  "cooking",
  "mathematics",
  "technology",
  "politics",
  "religion",
  "education",
  "horror",
  "thriller",
  "adventure",
  "classic_literature",
  "young_adult",
  "self_help",
  "business",
  "nature",
  "sociology",
];

interface OLWork {
  title: string;
  authors?: { name: string }[];
  cover_id?: number;
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
}

interface BookRecord {
  isbn: string | null;
  title: string;
  author: string;
  cover_url: string | null;
  publisher: string | null;
  published_year: number | null;
  page_count: number | null;
}

async function fetchSubject(subject: string, limit: number): Promise<OLWork[]> {
  const url = `https://openlibrary.org/subjects/${subject}.json?limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.works ?? [];
  } catch {
    console.error(`Failed to fetch subject: ${subject}`);
    return [];
  }
}

function workToBook(work: OLWork): BookRecord | null {
  const author = work.authors?.[0]?.name;
  if (!author || !work.title) return null;

  return {
    isbn: work.isbn?.[0] ?? null,
    title: work.title,
    author,
    cover_url: work.cover_id
      ? `https://covers.openlibrary.org/b/id/${work.cover_id}-M.jpg`
      : null,
    publisher: work.publisher?.[0] ?? null,
    published_year: work.first_publish_year ?? null,
    page_count: work.number_of_pages_median ?? null,
  };
}

async function seed() {
  console.log("Fetching books from Open Library...");

  const booksPerSubject = Math.ceil(2200 / SUBJECTS.length);
  const allBooks: BookRecord[] = [];
  const seen = new Set<string>();

  for (const subject of SUBJECTS) {
    console.log(`  Fetching ${subject}...`);
    const works = await fetchSubject(subject, booksPerSubject);

    for (const work of works) {
      const book = workToBook(work);
      if (!book) continue;
      const key = `${book.title}::${book.author}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allBooks.push(book);
    }

    // Rate limit politeness
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nFetched ${allBooks.length} unique books. Inserting...`);

  // Insert books in batches of 100
  const insertedBooks: { id: string; title: string; author: string }[] = [];

  for (let i = 0; i < allBooks.length; i += 100) {
    const batch = allBooks.slice(i, i + 100);
    const { data, error } = await supabase
      .from("books")
      .upsert(batch, { onConflict: "isbn", ignoreDuplicates: true })
      .select("id, title, author");

    if (error) {
      console.error(`Batch ${i} error:`, error.message);
      // Try one by one for this batch
      for (const book of batch) {
        const { data: single, error: singleErr } = await supabase
          .from("books")
          .insert(book)
          .select("id, title, author")
          .single();
        if (single) insertedBooks.push(single);
        else if (singleErr && singleErr.code !== "23505")
          console.error(`  Skip: ${book.title} — ${singleErr.message}`);
      }
    } else if (data) {
      insertedBooks.push(...data);
    }
    process.stdout.write(`  Books: ${insertedBooks.length}\r`);
  }

  console.log(`\nInserted ${insertedBooks.length} books.`);

  // Extract unique authors
  const uniqueAuthors = [...new Set(insertedBooks.map((b) => b.author))];
  console.log(`Creating ${uniqueAuthors.length} authors...`);

  const authorIdMap = new Map<string, string>();

  for (let i = 0; i < uniqueAuthors.length; i += 100) {
    const batch = uniqueAuthors.slice(i, i + 100).map((name) => ({ name }));
    const { data, error } = await supabase
      .from("authors")
      .upsert(batch, { onConflict: "name", ignoreDuplicates: true })
      .select("id, name");

    if (data) {
      for (const a of data) authorIdMap.set(a.name, a.id);
    }
    if (error) console.error(`Authors batch error:`, error.message);
  }

  // Fetch any authors that were already there (upsert with ignoreDuplicates may not return them)
  if (authorIdMap.size < uniqueAuthors.length) {
    const { data: allAuthors } = await supabase
      .from("authors")
      .select("id, name")
      .in("name", uniqueAuthors);
    if (allAuthors) {
      for (const a of allAuthors) authorIdMap.set(a.name, a.id);
    }
  }

  console.log(`Authors ready: ${authorIdMap.size}`);

  // Create wrote edges (author → book)
  console.log("Creating wrote edges...");
  const wroteEdges = insertedBooks
    .filter((b) => authorIdMap.has(b.author))
    .map((b) => ({
      source_type: "author",
      source_id: authorIdMap.get(b.author)!,
      target_type: "book",
      target_id: b.id,
      edge_type: "wrote",
    }));

  for (let i = 0; i < wroteEdges.length; i += 100) {
    const batch = wroteEdges.slice(i, i + 100);
    await supabase.from("edges").upsert(batch, {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
    process.stdout.write(`  Wrote edges: ${Math.min(i + 100, wroteEdges.length)}\r`);
  }
  console.log(`\nCreated ${wroteEdges.length} wrote edges.`);

  // Create owns edges (user → book) — assign all books to the user
  console.log("Creating owns edges...");

  // Randomly assign statuses for variety
  const statuses = ["owns", "reading", "read", "wishlist"];
  const ownsEdges = insertedBooks.map((b) => ({
    source_type: "user",
    source_id: USER_ID,
    target_type: "book",
    target_id: b.id,
    edge_type: statuses[Math.floor(Math.random() * statuses.length)],
    metadata: JSON.stringify(
      Math.random() > 0.5 ? { rating: Math.ceil(Math.random() * 5) } : {}
    ),
  }));

  for (let i = 0; i < ownsEdges.length; i += 100) {
    const batch = ownsEdges.slice(i, i + 100);
    await supabase.from("edges").upsert(batch, {
      onConflict: "source_type,source_id,target_type,target_id,edge_type",
      ignoreDuplicates: true,
    });
    process.stdout.write(`  Owns edges: ${Math.min(i + 100, ownsEdges.length)}\r`);
  }
  console.log(`\nCreated ${ownsEdges.length} user→book edges.`);

  console.log("\nDone! Seed complete.");
}

seed().catch(console.error);
