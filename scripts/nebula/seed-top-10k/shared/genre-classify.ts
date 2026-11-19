/**
 * Classify an ISFDB candidate into {sci-fi, fantasy, horror} from its tags.
 * Tie-break priority: horror > sci-fi > fantasy (horror under-indexes on ISFDB
 * and should win ties against the sf/f spectrum).
 */

import type { CanonicalGenre, IsfdbCandidate } from "./types";

// Ordered: most specific / horror-first, then sci-fi, then fantasy. First match wins.
const TAG_PATTERNS: Array<{ pattern: RegExp; genre: CanonicalGenre; sub?: string }> = [
  { pattern: /\b(cosmic\s*horror|lovecraft)/i, genre: "horror", sub: "cosmic" },
  { pattern: /\b(psychological\s*horror)/i, genre: "horror", sub: "psychological" },
  { pattern: /\b(supernatural\s*horror|ghost\s*stor|haunted|haunting)/i, genre: "horror", sub: "supernatural" },
  { pattern: /\b(slasher|splatter)/i, genre: "horror", sub: "slasher" },
  { pattern: /\b(vampire|werewolf|zombie)/i, genre: "horror", sub: "monster" },
  { pattern: /\b(weird\s*fiction|weird\s*tale)/i, genre: "horror", sub: "weird" },
  { pattern: /\bhorror\b/i, genre: "horror" },

  { pattern: /\b(hard\s*sf|hard\s*science\s*fiction)/i, genre: "sci-fi", sub: "hard_sf" },
  { pattern: /\b(space\s*opera)/i, genre: "sci-fi", sub: "space_opera" },
  { pattern: /\bcyberpunk\b/i, genre: "sci-fi", sub: "cyberpunk" },
  { pattern: /\b(post.apocalyp|apocalyp)/i, genre: "sci-fi", sub: "post_apocalyptic" },
  { pattern: /\bdystopi/i, genre: "sci-fi", sub: "dystopian" },
  { pattern: /\b(military\s*sf|military\s*science\s*fiction)/i, genre: "sci-fi", sub: "military" },
  { pattern: /\btime\s*travel/i, genre: "sci-fi", sub: "time_travel" },
  { pattern: /\bfirst\s*contact/i, genre: "sci-fi", sub: "first_contact" },
  { pattern: /\b(climate\s*fiction|cli.fi)/i, genre: "sci-fi", sub: "climate" },
  { pattern: /\bscience\s*fiction\b|\bsci.?fi\b|\bsf\b/i, genre: "sci-fi" },

  { pattern: /\bgrimdark\b/i, genre: "fantasy", sub: "grimdark" },
  { pattern: /\burban\s*fantasy\b/i, genre: "fantasy", sub: "urban" },
  { pattern: /\b(high\s*fantasy|epic\s*fantasy)\b/i, genre: "fantasy", sub: "epic" },
  { pattern: /\b(sword\s*(&|and)\s*sorcery)\b/i, genre: "fantasy", sub: "sword_and_sorcery" },
  { pattern: /\bportal\s*fantasy\b/i, genre: "fantasy", sub: "portal" },
  { pattern: /\bmythic\s*fantasy\b/i, genre: "fantasy", sub: "mythic" },
  { pattern: /\b(fairy\s*tale|fairytale)\b/i, genre: "fantasy", sub: "fairy_tale" },
  { pattern: /\bmagic\s*school\b|\bacademy\b/i, genre: "fantasy", sub: "academy" },
  { pattern: /\bfantasy\b/i, genre: "fantasy" },
];

const TITLE_KEYWORD_FALLBACK: Array<{ pattern: RegExp; genre: CanonicalGenre }> = [
  { pattern: /\b(haunt|ghost|vampire|werewolf|zombie|blood|devil|cursed)\b/i, genre: "horror" },
  { pattern: /\b(space|galaxy|galactic|robot|cyber|android|mars|jupiter|starship)\b/i, genre: "sci-fi" },
  { pattern: /\b(dragon|wizard|elf|kingdom|magic|sorcerer|knight|throne)\b/i, genre: "fantasy" },
];

export interface GenreClassification {
  genre: CanonicalGenre;
  sub_genre: string | null;
  source: "tags" | "title_fallback" | "default";
}

export function classifyGenre(candidate: IsfdbCandidate): GenreClassification {
  const joined = candidate.tags.join(" | ").toLowerCase();
  for (const { pattern, genre, sub } of TAG_PATTERNS) {
    if (pattern.test(joined)) {
      return { genre, sub_genre: sub ?? null, source: "tags" };
    }
  }

  // Title fallback
  for (const { pattern, genre } of TITLE_KEYWORD_FALLBACK) {
    if (pattern.test(candidate.title)) {
      return { genre, sub_genre: null, source: "title_fallback" };
    }
  }

  // Default: unknown — caller may filter these out.
  return { genre: "unknown", sub_genre: null, source: "default" };
}
