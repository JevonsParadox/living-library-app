/**
 * Shared title / author / ISBN normalisation used by match steps
 * (e.g. ISFDB -> nb_books matching). Pure functions, no I/O.
 */

const LEADING_ARTICLES = /^(the|a|an)\s+/i;
const PUNCT = /[\p{P}\p{S}]+/gu;
const WHITESPACE = /\s+/g;

/**
 * Normalise a title for exact-match key comparison.
 * lowercase, strip punctuation, collapse whitespace, drop leading articles.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(PUNCT, " ")
    .replace(WHITESPACE, " ")
    .trim()
    .replace(LEADING_ARTICLES, "");
}

/**
 * Normalise a full author name. Strips punctuation + collapses whitespace.
 * Does not reorder "Last, First" — use authorSurname for surname-only keys.
 */
export function normaliseAuthor(raw: string): string {
  return raw
    .toLowerCase()
    .replace(PUNCT, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

/**
 * Extract a surname key from an author name.
 * Handles "First Last", "Last, First", "First M. Last", and initials.
 */
export function authorSurname(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.includes(",")) {
    return normaliseAuthor(trimmed.split(",")[0]);
  }

  const parts = trimmed.split(/\s+/);
  return normaliseAuthor(parts[parts.length - 1]);
}

/**
 * Build a (title, surname) composite key for de-duplication / matching.
 */
export function titleAuthorKey(title: string, author: string): string {
  return `${normaliseTitle(title)}|${authorSurname(author)}`;
}

/**
 * Strip all non-digit / non-X characters. Returns uppercase.
 * Empty string if nothing left.
 */
export function normaliseIsbn(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^0-9X]/g, "");
}

/**
 * Convert a 10-digit ISBN to its 13-digit equivalent.
 * Returns "" for invalid input.
 */
export function isbn10to13(isbn10: string): string {
  const n = normaliseIsbn(isbn10);
  if (n.length !== 10) return "";

  const core = `978${n.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(core[i]);
    if (Number.isNaN(digit)) return "";
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

/**
 * Convert a 13-digit ISBN (starting 978) back to 10 digits.
 * Returns "" for 979- prefixes (no 10-digit form) or invalid input.
 */
export function isbn13to10(isbn13: string): string {
  const n = normaliseIsbn(isbn13);
  if (n.length !== 13 || !n.startsWith("978")) return "";

  const core = n.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(core[i]);
    if (Number.isNaN(digit)) return "";
    sum += digit * (10 - i);
  }
  const mod = sum % 11;
  const checkNum = (11 - mod) % 11;
  const check = checkNum === 10 ? "X" : String(checkNum);
  return `${core}${check}`;
}

/**
 * Return both ISBN forms given either. Missing entries are empty strings.
 */
export function expandIsbn(raw: string | null | undefined): { isbn10: string; isbn13: string } {
  const n = normaliseIsbn(raw);
  if (n.length === 13) return { isbn10: isbn13to10(n), isbn13: n };
  if (n.length === 10) return { isbn10: n, isbn13: isbn10to13(n) };
  return { isbn10: "", isbn13: "" };
}
