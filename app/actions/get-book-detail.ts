"use server";

import { createAuthClient } from "@/lib/supabase-server";

export interface BookDetail {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  description: string | null;
  isbn: string | null;
  status: string | null;
  rating: number | null;
  notes: string | null;
}

export async function getBookDetail(bookId: string): Promise<BookDetail | null> {
  const supabase = await createAuthClient();

  const [{ data: book }, { data: edge }] = await Promise.all([
    supabase.from("books").select("*").eq("id", bookId).single(),
    supabase
      .from("edges")
      .select("edge_type, metadata")
      .eq("source_type", "user")
      .eq("target_type", "book")
      .eq("target_id", bookId)
      .in("edge_type", ["owns", "reading", "read", "wishlist"])
      .single(),
  ]);

  if (!book) return null;

  const metadata = (edge?.metadata as Record<string, unknown>) ?? {};

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.cover_url,
    publisher: book.publisher,
    publishedYear: book.published_year,
    pageCount: book.page_count,
    description: book.description,
    isbn: book.isbn,
    status: edge?.edge_type ?? null,
    rating: (metadata.rating as number) ?? null,
    notes: (metadata.notes as string) ?? null,
  };
}
