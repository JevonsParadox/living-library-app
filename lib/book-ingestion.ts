/**
 * Shared book ingestion pipeline.
 * Creates book + author + edges (wrote, owns, belongs_to) in Supabase.
 * Used by all capture methods.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapToSubjects, mapToThemes } from "@/lib/open-library";

// --- Types ---

export interface BookToIngest {
  title: string;
  author: string;
  isbn?: string | null;
  coverUrl?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  description?: string | null;
  subjects?: string[];          // Open Library raw subjects
  status?: string;              // owns | reading | read | wishlist
  rating?: number | null;
}

export interface IngestResult {
  bookId: string;
  title: string;
  isNew: boolean;               // true if book was created, false if already existed
  error?: string;
}

// --- Single book ingestion ---

export async function ingestBook(
  book: BookToIngest,
  userId: string,
  supabase: SupabaseClient
): Promise<IngestResult> {
  const title = book.title.trim();
  const authorName = book.author.trim();

  if (!title || !authorName) {
    return { bookId: "", title, isNew: false, error: "Title and author required" };
  }

  // 1. Find or create book
  let bookId: string;
  let isNew = false;

  const { data: existing } = await supabase
    .from("books")
    .select("id")
    .eq("title", title)
    .eq("author", authorName)
    .single();

  if (existing) {
    bookId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from("books")
      .insert({
        title,
        author: authorName,
        isbn: book.isbn ?? null,
        cover_url: book.coverUrl ?? null,
        publisher: book.publisher ?? null,
        published_year: book.publishedYear ?? null,
        page_count: book.pageCount ?? null,
        description: book.description ?? null,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { bookId: "", title, isNew: false, error: error?.message ?? "Failed to create book" };
    }
    bookId = created.id;
    isNew = true;
  }

  // 2. Find or create author + wrote edge
  const { data: existingAuthor } = await supabase
    .from("authors")
    .select("id")
    .eq("name", authorName)
    .single();

  let authorId: string;
  if (existingAuthor) {
    authorId = existingAuthor.id;
  } else {
    const { data: newAuthor } = await supabase
      .from("authors")
      .insert({ name: authorName })
      .select("id")
      .single();
    authorId = newAuthor?.id ?? "";
  }

  if (authorId) {
    await supabase
      .from("edges")
      .upsert(
        {
          source_type: "author",
          source_id: authorId,
          target_type: "book",
          target_id: bookId,
          edge_type: "wrote",
        },
        { onConflict: "source_type,source_id,target_type,target_id,edge_type" }
      );
  }

  // 3. Create owns/reading/read/wishlist edge
  const status = book.status ?? "owns";
  const metadata: Record<string, unknown> = {};
  if (book.rating) metadata.rating = book.rating;
  if (status === "read") metadata.read_at = new Date().toISOString();

  const { error: edgeError } = await supabase
    .from("edges")
    .upsert(
      {
        source_type: "user",
        source_id: userId,
        target_type: "book",
        target_id: bookId,
        edge_type: status,
        metadata: Object.keys(metadata).length > 0 ? metadata : {},
      },
      { onConflict: "source_type,source_id,target_type,target_id,edge_type" }
    );

  if (edgeError) {
    return { bookId, title, isNew, error: edgeError.message };
  }

  // 4. Auto-assign subjects via belongs_to edges
  const subjectNames = book.subjects
    ? mapToSubjects(book.subjects)
    : [];

  if (subjectNames.length > 0) {
    // Look up subject IDs
    const { data: subjectRows } = await supabase
      .from("subjects")
      .select("id, name")
      .in("name", subjectNames);

    if (subjectRows && subjectRows.length > 0) {
      const belongsToEdges = subjectRows.map((s) => ({
        source_type: "book",
        source_id: bookId,
        target_type: "subject",
        target_id: s.id,
        edge_type: "belongs_to",
      }));

      await supabase
        .from("edges")
        .upsert(belongsToEdges, {
          onConflict: "source_type,source_id,target_type,target_id,edge_type",
        });
    }
  }

  // 5. Auto-assign themes via linked_to edges
  const themeNames = book.subjects
    ? mapToThemes(book.subjects)
    : [];

  if (themeNames.length > 0) {
    const { data: themeRows } = await supabase
      .from("themes")
      .select("id, name")
      .in("name", themeNames);

    if (themeRows && themeRows.length > 0) {
      const linkedToEdges = themeRows.map((t) => ({
        source_type: "book",
        source_id: bookId,
        target_type: "theme",
        target_id: t.id,
        edge_type: "linked_to",
      }));

      await supabase
        .from("edges")
        .upsert(linkedToEdges, {
          onConflict: "source_type,source_id,target_type,target_id,edge_type",
        });
    }
  }

  return { bookId, title, isNew };
}

// --- Batch ingestion ---

export async function ingestBooks(
  books: BookToIngest[],
  userId: string,
  supabase: SupabaseClient
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];

  // Process sequentially to avoid overwhelming Supabase
  // (could parallelise in batches of 5 if speed is an issue)
  for (const book of books) {
    const result = await ingestBook(book, userId, supabase);
    results.push(result);
  }

  return results;
}
