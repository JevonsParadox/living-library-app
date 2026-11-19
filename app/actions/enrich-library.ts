"use server";

import { auth } from "@clerk/nextjs/server";
import { createAuthClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { searchBooks, mapToSubjects, mapToThemes } from "@/lib/open-library";

// --- Helpers ---

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Step 1: Enrich existing book metadata ---

export async function enrichBookMetadata(): Promise<{
  enriched: number;
  total: number;
  errors: string[];
}> {
  const { userId } = await auth();
  if (!userId) return { enriched: 0, total: 0, errors: ["Not authenticated"] };

  const supabase = await createAuthClient();

  // Get all user's book IDs
  const { data: userEdges } = await supabase
    .from("edges")
    .select("target_id")
    .eq("source_type", "user")
    .eq("target_type", "book")
    .in("edge_type", ["owns", "reading", "read", "wishlist"]);

  if (!userEdges || userEdges.length === 0) {
    return { enriched: 0, total: 0, errors: [] };
  }

  const bookIds = userEdges.map((e) => e.target_id).slice(0, 200);

  // Get books missing covers
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, isbn, cover_url")
    .in("id", bookIds);

  if (!books) return { enriched: 0, total: 0, errors: ["Failed to fetch books"] };

  const toEnrich = books.filter((b) => !b.cover_url);
  const errors: string[] = [];
  let enriched = 0;

  // Process in batches of 5 with delays
  for (let i = 0; i < toEnrich.length; i += 5) {
    const batch = toEnrich.slice(i, i + 5);

    await Promise.all(
      batch.map(async (book) => {
        try {
          const query = `"${book.title}" ${book.author}`;
          const results = await searchBooks(query, 1);

          if (results.length === 0) return;

          const match = results[0];
          const updates: Record<string, unknown> = {};

          if (match.coverUrl) updates.cover_url = match.coverUrl;
          if (match.isbn && !book.isbn) updates.isbn = match.isbn;
          if (match.pageCount) updates.page_count = match.pageCount;
          if (match.publisher) updates.publisher = match.publisher;

          if (Object.keys(updates).length > 0) {
            await supabase.from("books").update(updates).eq("id", book.id);
            enriched++;
          }
        } catch {
          errors.push(`Enrich failed: ${book.title}`);
        }
      })
    );

    // Rate limit: ~300ms between batches
    if (i + 5 < toEnrich.length) await sleep(300);
  }

  return { enriched, total: toEnrich.length, errors };
}

// --- Step 2: Seed comprehensive recommendations ---

export async function seedComprehensiveRecs(): Promise<{
  processed: number;
  recsCreated: number;
  errors: string[];
}> {
  const { userId } = await auth();
  if (!userId) return { processed: 0, recsCreated: 0, errors: ["Not authenticated"] };

  const supabase = await createAuthClient();

  // Get user's library
  const { data: userEdges } = await supabase
    .from("edges")
    .select("target_id")
    .eq("source_type", "user")
    .eq("target_type", "book")
    .in("edge_type", ["owns", "reading", "read", "wishlist"]);

  if (!userEdges || userEdges.length === 0) {
    return { processed: 0, recsCreated: 0, errors: [] };
  }

  const ownedBookIds = new Set(userEdges.map((e) => e.target_id));
  const bookIdList = [...ownedBookIds].slice(0, 200);

  // Get book details
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, isbn")
    .in("id", bookIdList);

  if (!books) return { processed: 0, recsCreated: 0, errors: ["Failed to fetch books"] };

  // Get existing recommendation counts per book
  const { data: existingRecs } = await supabase
    .from("edges")
    .select("source_id, target_id")
    .eq("source_type", "book")
    .eq("target_type", "book")
    .eq("edge_type", "recommended")
    .in("source_id", bookIdList);

  const recCounts = new Map<string, number>();
  const existingRecTargets = new Set<string>();
  for (const e of existingRecs ?? []) {
    recCounts.set(e.source_id, (recCounts.get(e.source_id) ?? 0) + 1);
    existingRecTargets.add(e.target_id);
  }

  // Get subject + theme IDs
  const [{ data: subjects }, { data: themes }] = await Promise.all([
    supabase.from("subjects").select("id, name"),
    supabase.from("themes").select("id, name"),
  ]);
  const subjectMap = new Map(subjects?.map((s) => [s.name, s.id]) ?? []);
  const themeMap = new Map(themes?.map((t) => [t.name, t.id]) ?? []);

  // Track all book titles to avoid duplicates
  const { data: allBooks } = await supabase.from("books").select("id, title, author");
  const existingBooks = new Map(
    allBooks?.map((b) => [`${b.title.toLowerCase()}|${b.author.toLowerCase()}`, b.id]) ?? []
  );

  // Get which subjects each book belongs to (for subject-based search)
  const { data: belongsToEdges } = await supabase
    .from("edges")
    .select("source_id, target_id")
    .eq("source_type", "book")
    .eq("target_type", "subject")
    .eq("edge_type", "belongs_to")
    .in("source_id", bookIdList);

  const bookSubjects = new Map<string, string[]>();
  for (const e of belongsToEdges ?? []) {
    const subjectName = [...subjectMap.entries()].find(([, id]) => id === e.target_id)?.[0];
    if (subjectName) {
      const existing = bookSubjects.get(e.source_id) ?? [];
      existing.push(subjectName);
      bookSubjects.set(e.source_id, existing);
    }
  }

  const errors: string[] = [];
  let processed = 0;
  let recsCreated = 0;

  // Process each book that needs more recs
  for (let i = 0; i < books.length; i += 3) {
    const batch = books.slice(i, i + 3);

    for (const book of batch) {
      const currentCount = recCounts.get(book.id) ?? 0;
      if (currentCount >= 3) {
        processed++;
        continue;
      }

      const needed = 3 - currentCount;

      try {
        processed++;
        const candidates: { title: string; author: string; isbn: string | null; coverUrl: string | null; publishedYear: number | null; publisher: string | null; pageCount: number | null; subjects: string[] }[] = [];

        // Primary: search by book's subjects
        const subjects = bookSubjects.get(book.id) ?? [];
        if (subjects.length > 0) {
          const subjectQuery = subjects.slice(0, 2).join(" ");
          const subjectResults = await searchBooks(subjectQuery, 10);
          for (const r of subjectResults) {
            const key = `${r.title.toLowerCase()}|${r.author.toLowerCase()}`;
            if (!existingBooks.has(key) && !existingRecTargets.has(existingBooks.get(key) ?? "") &&
                r.title.toLowerCase() !== book.title.toLowerCase()) {
              candidates.push(r);
            }
          }
        }

        // Secondary: search by author
        if (candidates.length < needed) {
          const authorResults = await searchBooks(book.author, 8);
          for (const r of authorResults) {
            const key = `${r.title.toLowerCase()}|${r.author.toLowerCase()}`;
            if (!existingBooks.has(key) && r.title.toLowerCase() !== book.title.toLowerCase() &&
                !candidates.some((c) => c.title.toLowerCase() === r.title.toLowerCase())) {
              candidates.push(r);
            }
          }
        }

        // Tertiary: search by title keywords
        if (candidates.length < needed) {
          const titleWords = book.title.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 2).join(" ");
          if (titleWords) {
            const titleResults = await searchBooks(titleWords, 6);
            for (const r of titleResults) {
              const key = `${r.title.toLowerCase()}|${r.author.toLowerCase()}`;
              if (!existingBooks.has(key) && r.title.toLowerCase() !== book.title.toLowerCase() &&
                  !candidates.some((c) => c.title.toLowerCase() === r.title.toLowerCase())) {
                candidates.push(r);
              }
            }
          }
        }

        // Take what we need
        const selected = candidates.slice(0, needed);

        for (const rec of selected) {
          const key = `${rec.title.toLowerCase()}|${rec.author.toLowerCase()}`;
          let recBookId = existingBooks.get(key);

          if (!recBookId) {
            // Create book record
            const { data: created } = await supabase
              .from("books")
              .insert({
                title: rec.title,
                author: rec.author,
                isbn: rec.isbn ?? null,
                cover_url: rec.coverUrl ?? null,
                publisher: rec.publisher ?? null,
                published_year: rec.publishedYear ?? null,
                page_count: rec.pageCount ?? null,
              })
              .select("id")
              .single();

            if (!created) continue;
            recBookId = created.id;
            existingBooks.set(key, recBookId);
          }

          // Create recommended edge
          await supabase.from("edges").upsert(
            {
              source_type: "book",
              source_id: book.id,
              target_type: "book",
              target_id: recBookId,
              edge_type: "recommended",
              metadata: { source_title: book.title },
            },
            { onConflict: "source_type,source_id,target_type,target_id,edge_type" }
          );

          // Create author + wrote edge
          const { data: existingAuthor } = await supabase
            .from("authors")
            .select("id")
            .eq("name", rec.author)
            .single();

          let authorId = existingAuthor?.id;
          if (!authorId) {
            const { data: newAuthor } = await supabase
              .from("authors")
              .insert({ name: rec.author })
              .select("id")
              .single();
            authorId = newAuthor?.id;
          }

          if (authorId) {
            await supabase.from("edges").upsert(
              {
                source_type: "author",
                source_id: authorId,
                target_type: "book",
                target_id: recBookId,
                edge_type: "wrote",
              },
              { onConflict: "source_type,source_id,target_type,target_id,edge_type" }
            );
          }

          // Create belongs_to edges (subjects)
          const recSubjects = rec.subjects ? mapToSubjects(rec.subjects) : [];
          const subjectEdges = recSubjects
            .map((name) => subjectMap.get(name))
            .filter((id): id is string => !!id)
            .map((subjectId) => ({
              source_type: "book",
              source_id: recBookId!,
              target_type: "subject",
              target_id: subjectId,
              edge_type: "belongs_to",
            }));

          if (subjectEdges.length > 0) {
            await supabase.from("edges").upsert(subjectEdges, {
              onConflict: "source_type,source_id,target_type,target_id,edge_type",
            });
          }

          // Create linked_to edges (themes)
          const recThemes = rec.subjects ? mapToThemes(rec.subjects) : [];
          const themeEdges = recThemes
            .map((name) => themeMap.get(name))
            .filter((id): id is string => !!id)
            .map((themeId) => ({
              source_type: "book",
              source_id: recBookId!,
              target_type: "theme",
              target_id: themeId,
              edge_type: "linked_to",
            }));

          if (themeEdges.length > 0) {
            await supabase.from("edges").upsert(themeEdges, {
              onConflict: "source_type,source_id,target_type,target_id,edge_type",
            });
          }

          existingRecTargets.add(recBookId);
          recsCreated++;
        }
      } catch {
        errors.push(`Recs failed: ${book.title}`);
      }
    }

    // Rate limit between batches
    if (i + 3 < books.length) await sleep(400);
  }

  revalidatePath("/universe");
  return { processed, recsCreated, errors };
}
