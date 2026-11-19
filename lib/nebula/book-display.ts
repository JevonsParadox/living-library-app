/**
 * Display rules shared between the 3D BookCloud renderer and the 2D
 * force-directed graph view. Single source of truth for:
 *
 *   - Three-tier paint model (shelf / illuminated / background) keyed by
 *     library state + the context-computed illuminationMap
 *   - Size in [0, 1] derived from a 0.8/0.2 blend of popularity_score and
 *     engagement_score
 *   - Region planet brightness scaled by shelf count
 *
 * Pure functions; no React, no THREE.
 *
 * Design — the universe responds to YOUR shelf:
 *   - "shelf" tier: books you own / wishlist. Full state colour, full size.
 *   - "illuminated" tier: ~6 nearest neighbours of each shelf book. Soft
 *     universal grey-white so candidates read distinctly from yours.
 *   - "background" tier: everything else. Region colour at low alpha so a
 *     hint of structure remains without competing with your map. Empty
 *     shelf naturally puts every book in the background tier; the
 *     EmptyShelfPrompt invites the first upload.
 */

import type { UserBookState } from "./nebula-types";

// ---------- Colors ----------

/** Indigo: book exists in the catalog but the user hasn't interacted with it. */
export const CLOUD_COLOR = "#6366F1";
/** Library-state colors. Match the pill colors in BookDetailPanel. */
export const READ_COLOR = "#FFD700";
export const READING_COLOR = "#34D399";
export const NEXT_UP_COLOR = "#F59E0B";
export const ON_SHELF_COLOR = "#38BDF8";
export const WISHLIST_COLOR = "#C084FC";
/** Active selection (white) and series-sibling highlight (amber). */
export const SELECTED_COLOR = "#FFFFFF";
export const SERIES_SIBLING_COLOR = "#F59E0B";
/** Uniform dark purple for illuminated recommendations. Chosen specifically
 *  to be distinct from the region palette (blue/green/teal/red/etc.) so an
 *  illuminated book reads as "candidate" regardless of which region it sits
 *  in. Earlier iterations used soft grey-white (#9CA3AF), but the additive
 *  blending of region planet halos tinted the bright grey toward the
 *  region colour — making illuminated books look like part of their
 *  region rather than uniform recommendations. A dark purple base is
 *  resistant to additive shifts (small region contributions barely move
 *  a near-black fragment) and is not a region colour anywhere in the map. */
export const ILLUMINATED_COLOR = "#4A3568";
/** Silver rim used by 3D fresnel shader's rim component for illuminated
 *  books. Combined with the dark-purple core, the result is "dark body
 *  with a crisp silver outline" — visible against any background, makes
 *  the 6 candidates around each shelf book easy to count. Not a region
 *  colour, so collision-free across the map. */
export const ILLUMINATED_RIM_COLOR = "#C0C0C0";

// ---------- Tier intensities ----------
//
// Sizes are multipliers on `BASE_RADIUS × (0.5 + displayScore01 × 1.5)`:
//   - Shelf 2.0× matches the old SCALE_READ baseline so shelf books read
//     as proper stars at galaxy zoom.
//   - Illuminated 0.7× — "a little larger" than background, distinctly
//     smaller than shelf. Earlier iterations had this at 1.5× which made
//     127 illuminated books visually dominate the 30 shelf books;
//     spec was "a little larger but not a vibrant colour", so a touch
//     above background is the right sense.
//   - Background 0.4× is a tiny dot — present, never dominant.
//
// Alpha factors are gated by the per-instance shader attribute so dim
// tier truly renders dim. Illuminated 0.5 (was 0.85) so the soft
// grey-white reads clearly as "candidate" rather than "almost-shelf".
// Background 0.15 so additive halos don't accumulate into a wash at
// close zoom (further softened by squared-alpha in the glow shader).
export const BACKGROUND_DIM_ALPHA = 0.15;
export const BACKGROUND_SIZE_FACTOR = 0.4;
/** D7 fog of exploration: how much further a far-from-activity background
 *  book dims, on top of BACKGROUND_DIM_ALPHA. 0.7 means a book at
 *  fogLevel=1 (farthest from any shelf/illuminated book) drops to 30%
 *  of the base background alpha — effective alpha ≈ 0.045. Books at
 *  fogLevel=0 are unchanged. Empty shelf bypasses fog entirely. */
export const FOG_DIM_RANGE = 0.7;
export const ILLUMINATED_ALPHA = 0.7;
// Match shelf size (2.0×) so the dark-core / purple-rim fresnel pattern
// reads clearly. Differentiation from shelf is via colour (uniform dark
// purple vs vibrant state colour), not size — at smaller sizes the
// fresnel gradient was too small to see, making illuminated books read
// as just "dim dots" with no visible outline.
export const ILLUMINATED_SIZE_FACTOR = 2.0;
export const SHELF_ALPHA = 1.0;
export const SHELF_SIZE_FACTOR = 2.0;

export type BookPaintTier = "shelf" | "illuminated" | "background";

export interface PaintIntensity {
  /** Core / halo colour. Used by halo glow material and by the fresnel
   *  shader's core-fragment calculation (× 0.25). Dim base of the book. */
  color: string;
  /** Rim colour for the fresnel outline (× 1.6 at the brightest fresnel
   *  point). For most tiers `rimColor === color` so behaviour is unchanged.
   *  Illuminated splits these — dark purple core with a silver rim so the
   *  outline reads against any background. */
  rimColor: string;
  sizeFactor: number;
  alphaFactor: number;
  tier: BookPaintTier;
}

export function libraryStateColor(state: UserBookState | undefined): string {
  if (!state) return CLOUD_COLOR;
  if (state.ownership === "wishlist") return WISHLIST_COLOR;
  switch (state.status) {
    case "read": return READ_COLOR;
    case "reading": return READING_COLOR;
    case "next_up": return NEXT_UP_COLOR;
    case "unread":
    default: return ON_SHELF_COLOR;
  }
}

/**
 * Compute the full paint package for a single book — tier, color, size
 * factor, alpha factor — given its library state, illumination flag, and
 * contextual highlight flags. This is the single helper both renderers
 * should call.
 *
 * Tier precedence: shelf > illuminated > background. Selection / series
 * highlighting overrides the colour but does NOT change the tier — we
 * don't want a selected background book to suddenly grow to shelf size.
 * Tier still dictates sizeFactor + alphaFactor, just colour gets swapped.
 */
export function paintIntensity(opts: {
  libraryState: UserBookState | undefined;
  isIlluminated: boolean;
  regionColor?: string | null;
  isSelected?: boolean;
  isSeriesSibling?: boolean;
  /** D7 fog of exploration. Applied to background tier only — far-from-
   *  activity books fade further so the explored zone reads warmer. 0..1.
   *  Undefined or 0 = no fog (full background brightness). */
  fogLevel?: number;
}): PaintIntensity {
  // Resolve a colour override that applies regardless of tier.
  const overrideColor =
    opts.isSelected ? SELECTED_COLOR
    : opts.isSeriesSibling ? SERIES_SIBLING_COLOR
    : null;

  if (opts.libraryState) {
    const c = overrideColor ?? libraryStateColor(opts.libraryState);
    return {
      color: c,
      rimColor: c,
      sizeFactor: SHELF_SIZE_FACTOR,
      alphaFactor: SHELF_ALPHA,
      tier: "shelf",
    };
  }
  if (opts.isIlluminated) {
    return {
      color: overrideColor ?? ILLUMINATED_COLOR,
      // Override unconditionally — selection / sibling highlights still
      // override the core colour, but the silver rim is the consistent
      // signal that this book is a recommendation, not yours.
      rimColor: ILLUMINATED_RIM_COLOR,
      sizeFactor: ILLUMINATED_SIZE_FACTOR,
      alphaFactor: ILLUMINATED_ALPHA,
      tier: "illuminated",
    };
  }
  const bg = overrideColor ?? (opts.regionColor ?? CLOUD_COLOR);
  // D7: dim distant background books further. Bounded so the
  // multiplier stays in [1 - FOG_DIM_RANGE, 1] = [0.3, 1] for fog 0..1.
  const fog = Math.max(0, Math.min(1, opts.fogLevel ?? 0));
  const fogAlpha = BACKGROUND_DIM_ALPHA * (1 - fog * FOG_DIM_RANGE);
  return {
    color: bg,
    rimColor: bg,
    sizeFactor: BACKGROUND_SIZE_FACTOR,
    alphaFactor: fogAlpha,
    tier: "background",
  };
}

/**
 * Color of a region planet whose user-shelf count is zero. Dark muted
 * slate — reads as "available but unexplored". Once the first book in
 * the region lands, the planet animates from this color to its real
 * region.color_hex (see D2 awakening lerp in RegionPlanets.tsx +
 * NebulaView2D.tsx paintNode). Same hex in both 2D and 3D for parity.
 */
export const EMPTY_REGION_COLOR = "#3A3F47";

/**
 * Region planet brightness scaled by shelf count. Planets always visible
 * (navigational landmarks); a region with 0 owned books is a faint
 * outline, with 30+ books it's at full strength.
 *
 * sqrt scaling so the first few books move the needle visibly and a
 * heavy shelf doesn't blow out the visual.
 */
export function regionPlanetIntensity(opts: { shelfCount: number }): {
  alphaFactor: number;
  haloFactor: number;
} {
  const t = Math.min(1, Math.sqrt(opts.shelfCount / 30));
  // Floor at 0.7 (was 0.4 / 0.5) so empty regions read as "dim but
  // discernible" navigational landmarks rather than near-invisible.
  // Heavy-shelf regions still ramp to full strength.
  return {
    alphaFactor: 0.7 + 0.3 * t, // 0.7 → 1.0
    haloFactor: 0.7 + 0.3 * t,  // 0.7 → 1.0
  };
}

/**
 * Legacy color helper kept for callers not yet migrated to paintIntensity.
 * New consumers should call paintIntensity instead — it returns size and
 * alpha alongside colour, enabling the three-tier model.
 *
 * @deprecated Use paintIntensity for new code.
 */
export function colorForBook(opts: {
  libraryState: UserBookState | undefined;
  regionColor: string | null | undefined;
  isSelected: boolean;
  isSeriesSibling: boolean;
}): string {
  if (opts.isSelected) return SELECTED_COLOR;
  if (opts.isSeriesSibling) return SERIES_SIBLING_COLOR;
  if (opts.libraryState) return libraryStateColor(opts.libraryState);
  return opts.regionColor ?? CLOUD_COLOR;
}

// ---------- Size blend ----------

const POP_WEIGHT = 0.8;
const ENG_WEIGHT = 0.2;
const ENG_CAP = 100;

/**
 * Blend popularity_score (frozen seed value) with engagement_score (live
 * 90-day signal rollup) into a [0, 1] display intensity. Drives both 3D
 * point size and 2D node radius.
 *
 * Conservative weighting (80/20) for now while engagement_score accrues real
 * data. Easy to rebalance once engagement signals dominate.
 */
export function displayScore01(book: {
  popularity_score: number;
  engagement_score?: number;
}): number {
  const pop = Math.max(0, Math.min(1, book.popularity_score / 100));
  const eng = Math.max(0, Math.min(1, (book.engagement_score ?? 0) / ENG_CAP));
  return POP_WEIGHT * pop + ENG_WEIGHT * eng;
}
