/**
 * Resolve a (title, author, isbn) tuple to an existing nb_books work_id.
 *
 * Match chain:
 *   1. ISBN-13 exact on nb_editions
 *   2. ISBN-10 exact on nb_editions (plus ISBN-10 <-> 13 conversion fallback)
 *   3. Normalised title + normalised author surname on nb_books
 *   4. pg_trgm similarity on nb_books.title (auto-merge >= 0.78)
 *   5. 0.60-0.78 similarity -> 'trigram_review' (caller shelves to review queue)
 *   6. below 0.60 -> null (caller creates new shell)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorSurname,
  expandIsbn,
  normaliseTitle,
} from "./title-normalise";

export type MatchType =
  | "isbn13"
  | "isbn10"
  | "normalised"
  | "trigram_auto"
  | "trigram_review";

export interface ResolveInput {
  isbn13?: string | null;
  isbn10?: string | null;
  title: string;
  author: string;
}

export interface ResolveResult {
  workId: string;
  matchType: MatchType;
  confidence: number;
}

const AUTO_MERGE_THRESHOLD = 0.78;
const REVIEW_THRESHOLD = 0.6;

export async function resolveWork(
  supabase: SupabaseClient,
  input: ResolveInput,
): Promise<ResolveResult | null> {
  const { isbn13, isbn10 } = expandIsbn(input.isbn13 ?? input.isbn10 ?? "");

  // 1 & 2: ISBN lookup on nb_editions.
  if (isbn13 || isbn10) {
    const candidates: string[] = [];
    if (isbn13) candidates.push(isbn13);
    if (isbn10) candidates.push(isbn10);
    const { data } = await supabase
      .from("nb_editions")
      .select("work_id, isbn_13, isbn_10")
      .or(
        candidates
          .flatMap((c) => [`isbn_13.eq.${c}`, `isbn_10.eq.${c}`])
          .join(","),
      )
      .limit(1);

    if (data && data[0]) {
      const row = data[0];
      const matchType: MatchType = row.isbn_13 === isbn13 ? "isbn13" : "isbn10";
      return { workId: row.work_id as string, matchType, confidence: 1.0 };
    }
  }

  // 3: Normalised title + author surname on nb_books.
  const normTitle = normaliseTitle(input.title);
  const surname = authorSurname(input.author);

  if (normTitle.length >= 2) {
    // We don't have stored norm columns; do a two-step: pull candidates with
    // similar title via trigram, filter in JS for exact normalised match.
    const { data: normCandidates } = await supabase
      .from("nb_books")
      .select("id, title, primary_author_id, nb_authors!primary_author_id(name)")
      .textSearch("title", normTitle.split(" ").slice(0, 4).join(" "), {
        type: "websearch",
        config: "english",
      })
      .limit(20);

    if (normCandidates) {
      for (const row of normCandidates as unknown as NormCandidateRow[]) {
        const cNorm = normaliseTitle(row.title);
        const cSurname = authorSurname(row.nb_authors?.name ?? "");
        if (cNorm === normTitle && cSurname === surname && surname !== "") {
          return { workId: row.id, matchType: "normalised", confidence: 0.95 };
        }
      }
    }
  }

  // 4 & 5: pg_trgm similarity via an RPC-less trick — Supabase JS doesn't
  // expose the `%` operator, so we use `.ilike` for a coarse filter and
  // compute similarity on the candidate set in JS using a cheap Dice coefficient.
  const { data: trgCandidates } = await supabase
    .from("nb_books")
    .select("id, title, primary_author_id, nb_authors!primary_author_id(name)")
    .ilike("title", `%${input.title.slice(0, 20)}%`)
    .limit(10);

  if (trgCandidates && trgCandidates.length > 0) {
    let best: { id: string; score: number } | null = null;
    const combinedInput = `${normTitle} ${surname}`.trim();
    for (const row of trgCandidates as unknown as NormCandidateRow[]) {
      const combined = `${normaliseTitle(row.title)} ${authorSurname(row.nb_authors?.name ?? "")}`.trim();
      const score = diceCoefficient(combinedInput, combined);
      if (!best || score > best.score) best = { id: row.id, score };
    }

    if (best) {
      if (best.score >= AUTO_MERGE_THRESHOLD) {
        return { workId: best.id, matchType: "trigram_auto", confidence: best.score };
      }
      if (best.score >= REVIEW_THRESHOLD) {
        return { workId: best.id, matchType: "trigram_review", confidence: best.score };
      }
    }
  }

  return null;
}

interface NormCandidateRow {
  id: string;
  title: string;
  primary_author_id: string | null;
  nb_authors: { name: string } | null;
}

/**
 * Bigram Dice coefficient — a lightweight local alternative to pg_trgm.
 * 0 (disjoint) to 1 (identical). Suitable for short strings like title+surname.
 */
function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      out.set(bg, (out.get(bg) ?? 0) + 1);
    }
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let intersection = 0;
  for (const [k, countA] of A) {
    const countB = B.get(k) ?? 0;
    intersection += Math.min(countA, countB);
  }
  const total = Array.from(A.values()).reduce((s, n) => s + n, 0) +
    Array.from(B.values()).reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * intersection) / total;
}
