"use server";

import { lookupISBN, type OLBookDetail } from "@/lib/open-library";

export async function lookupIsbn(
  isbn: string
): Promise<{ book: OLBookDetail | null; error?: string }> {
  if (!isbn || isbn.trim().length < 10) {
    return { book: null, error: "Invalid ISBN" };
  }

  try {
    const book = await lookupISBN(isbn.trim().replace(/-/g, ""));
    return { book };
  } catch {
    return { book: null, error: "Lookup failed" };
  }
}
