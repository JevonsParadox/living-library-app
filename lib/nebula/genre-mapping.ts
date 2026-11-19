/**
 * Genre → region resolution for new shell creation.
 *
 * Two callers today:
 *   - createShellFromProvider in app/(nebula)/nebula/actions.ts when a
 *     user adds a book via search / barcode / CSV.
 *   - Any future re-classification script that wants to use the same
 *     rules to update an existing shell's region.
 *
 * Lifted from scripts/nebula/seed-nebula-from-csv.ts so the runtime path
 * and the offline seed use the same source of truth. See ADR-007's plan
 * section (genre mapping was the pending improvement on createShellFromProvider).
 */

/**
 * canonical_genre value → region slug.
 *
 * Keys come from inferGenreFromSubjects below + any explicit hint
 * passed through. Includes broad fallbacks ("fantasy", "sci-fi",
 * "horror") so callers can be lazy about the subgenre.
 */
export const GENRE_TO_REGION_SLUG: Record<string, string> = {
  // fantasy subgenres
  "fantasy:mythic": "mythic-fantasy",
  "fantasy:cozy": "cozy-fantasy",
  "fantasy:urban": "urban-fantasy",
  "fantasy:epic": "epic-fantasy",
  "fantasy:grimdark": "grimdark-fantasy",
  "fantasy:romantasy": "romantasy",
  "fantasy:science": "science-fantasy",

  // sci-fi subgenres
  "sci-fi:dystopian": "dystopian",
  "sci-fi:philosophical": "philosophical-sf",
  "sci-fi:space_opera": "space-opera",
  "sci-fi:military": "military-sf",
  "sci-fi:hard_sf": "hard-sf",
  "sci-fi:cyberpunk": "cyberpunk",

  // horror / weird
  "horror:weird": "weird-spec",

  // broad fallbacks
  fantasy: "epic-fantasy",
  "sci-fi": "space-opera",
  horror: "weird-spec",
};

/**
 * Infer a canonical_genre key from a book's subjects + title.
 *
 * Most-specific patterns first; first match wins. Empty-subjects input is
 * fine — function still works on title alone. Returns "fantasy" as the
 * last-resort default if nothing matches (matches the historical bias of
 * the catalog — most works in nb_books are SFF).
 *
 * Heuristic, not ML. Cheap, deterministic, easy to reason about. If we
 * ever want better classification, train an embedding-based classifier
 * over the subjects field and slot it in here — the call signature stays
 * the same.
 */
export function inferGenreFromSubjects(
  subjects: string[] | undefined,
  title: string,
): string {
  const text = [...(subjects ?? []), title].join(" ").toLowerCase();

  // Most-specific keywords first. Order matters — e.g. "cyberpunk" wins
  // over the broader "sci-fi" fallback.
  if (/cyberpunk|cyber\s*punk|biopunk/.test(text)) return "sci-fi:cyberpunk";
  if (/grimdark|grim\s*dark/.test(text)) return "fantasy:grimdark";
  if (/space\s*opera/.test(text)) return "sci-fi:space_opera";
  if (/military.*(?:sf|science|fiction)|space\s*marine|combat\s*fiction/.test(text)) return "sci-fi:military";
  if (/hard\s*(?:sf|science\s*fiction)|technical\s*sf/.test(text)) return "sci-fi:hard_sf";
  if (/first\s*contact|philosophical\s*(?:sf|fiction)|consciousness/.test(text)) return "sci-fi:philosophical";
  if (/dystop|post.?apoc|apocalyp|civilisation\s*collapse/.test(text)) return "sci-fi:dystopian";
  if (/urban\s*fantas|paranormal\s*(?:fiction|romance)/.test(text)) return "fantasy:urban";
  if (/cozy.*(?:fantas|fiction)|cosy.*(?:fantas|fiction)/.test(text)) return "fantasy:cozy";
  if (/romantasy|romantic\s*fantas|court\s*fantas|fae.*romance|fairy.*romance/.test(text)) return "fantasy:romantasy";
  if (/mythic|folklor|legend|mythology/.test(text)) return "fantasy:mythic";
  if (/(?:cosmic\s*)?horror|lovecraft|weird\s*fiction|gothic\s*fiction/.test(text)) return "horror:weird";
  if (/science\s*fantas/.test(text)) return "fantasy:science";

  // Broader bucket fallbacks
  if (/sci.?fi|science\s*fiction|\bspace\b|robot|alien|future|cybernet/.test(text)) return "sci-fi";
  if (/fantas|magic|wizard|dragon|sorcer|elves|elven|enchant/.test(text)) return "fantasy:epic";

  return "fantasy"; // last-resort default
}

/**
 * Resolve a canonical_genre → matching region row from a list. Falls back
 * to GENRE_TO_REGION_SLUG["fantasy"] (epic-fantasy) if the precise key
 * isn't in the map, and further falls back to undefined if even that slug
 * isn't in the provided regions list (i.e. the regions table is sparse).
 */
export function resolveRegionForGenre<T extends { id: string; slug: string | null }>(
  genre: string,
  regions: T[],
): T | undefined {
  const wantedSlug = GENRE_TO_REGION_SLUG[genre] ?? GENRE_TO_REGION_SLUG["fantasy"];
  return regions.find((r) => r.slug === wantedSlug);
}
