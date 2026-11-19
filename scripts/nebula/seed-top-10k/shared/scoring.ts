/**
 * Composite seed scoring.
 *
 * seed_score = 0.35*awards + 0.25*editions + 0.20*goodreads
 *            + 0.10*series_anchor + 0.07*recency + 0.03*canon
 */

import type { IsfdbCandidate, ScoredCandidate } from "./types";

const WEIGHTS = {
  awards: 0.35,
  editions: 0.25,
  goodreads: 0.20,
  series_anchor: 0.10,
  recency: 0.07,
  canon: 0.03,
};

// Awards recognised for the awards signal. Named vs enumeration makes it
// easy to tune or add new ones without touching scoring math.
const RECOGNISED_AWARDS: RegExp[] = [
  /hugo/i,
  /nebula/i,
  /world fantasy/i,
  /locus/i,
  /bram stoker/i,
  /shirley jackson/i,
  /british fantasy/i,
  /\bclarke\b/i,
  /philip k\.?\s*dick/i,
  /mythopoeic/i,
  /newbery/i,
  /tiptree|otherwise/i,
  /aurora/i,
  /ditmar/i,
  /campbell.*new writer/i,
];

function isRecognisedAward(name: string): boolean {
  return RECOGNISED_AWARDS.some((re) => re.test(name));
}

export function computeAwardsRaw(candidate: IsfdbCandidate): number {
  let raw = 0;
  for (const a of candidate.awards) {
    if (!isRecognisedAward(a.name)) continue;
    raw += a.result === "won" ? 10 : 3;
  }
  return raw;
}

export function recencySignal(year: number | null): number {
  if (!year) return 0.3;
  if (year >= 2020) return 1.0;
  if (year >= 2015) return 0.7;
  if (year >= 2005) return 0.5;
  if (year >= 1990) return 0.4;
  return 0.3;
}

export function seriesAnchorBonus(candidate: IsfdbCandidate): number {
  // Standalone = 0.5; first-in-series (when series exists and order is 1) = 1.0;
  // later-in-series = 0.3. Absent series -> treat as standalone.
  if (!candidate.series_id) return 0.5;
  const order = candidate.series_order;
  if (order === null || order === undefined) return 0.4;
  if (order <= 1) return 1.0;
  return 0.3;
}

export interface NormalisationBounds {
  awardsLog1pMax: number;
  editionsLog1pP99: number;
  goodreadsLog1pMax: number;
}

export function deriveNormalisationBounds(candidates: IsfdbCandidate[]): NormalisationBounds {
  let maxAwards = 1;
  const editions: number[] = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const raw = computeAwardsRaw(c);
    if (raw > maxAwards) maxAwards = raw;
    editions[i] = c.edition_count;
  }

  const awardsLog1pMax = Math.log1p(maxAwards);
  const editionsLog1pP99 = percentileLog1p(editions, 0.99);

  return {
    awardsLog1pMax,
    editionsLog1pP99,
    goodreadsLog1pMax: 0, // filled in by caller after join
  };
}

function percentileLog1p(values: number[], p: number): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return Math.log1p(Math.max(1, sorted[idx]));
}

export interface ScoringInput {
  candidate: IsfdbCandidate;
  goodreadsRatingsCount: number | null;
  isCanon: boolean;
  bounds: NormalisationBounds;
}

export function score(input: ScoringInput): ScoredCandidate {
  const { candidate, goodreadsRatingsCount, isCanon, bounds } = input;

  const awardsRaw = computeAwardsRaw(candidate);
  const awardsNorm = bounds.awardsLog1pMax > 0 ? Math.log1p(awardsRaw) / bounds.awardsLog1pMax : 0;

  const editionsNorm =
    bounds.editionsLog1pP99 > 0
      ? Math.min(1, Math.log1p(candidate.edition_count) / bounds.editionsLog1pP99)
      : 0;

  const goodreadsNorm =
    goodreadsRatingsCount && bounds.goodreadsLog1pMax > 0
      ? Math.log1p(goodreadsRatingsCount) / bounds.goodreadsLog1pMax
      : 0;

  const anchor = seriesAnchorBonus(candidate);
  const recency = recencySignal(candidate.publication_year);
  const canon = isCanon ? 1.0 : 0.0;

  const seed_score =
    WEIGHTS.awards * awardsNorm +
    WEIGHTS.editions * editionsNorm +
    WEIGHTS.goodreads * goodreadsNorm +
    WEIGHTS.series_anchor * anchor +
    WEIGHTS.recency * recency +
    WEIGHTS.canon * canon;

  return {
    ...candidate,
    goodreads_ratings_count: goodreadsRatingsCount,
    canonical_genre: "unknown",
    sub_genre: null,
    canon: isCanon,
    series_is_anchor: candidate.series_id !== null && (candidate.series_order ?? 1) <= 1,
    seed_score,
    signals: {
      awards: awardsNorm,
      editions: editionsNorm,
      goodreads: goodreadsNorm,
      series_anchor: anchor,
      recency,
      canon,
    },
  };
}
