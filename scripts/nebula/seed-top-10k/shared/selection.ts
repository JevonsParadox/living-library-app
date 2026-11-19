/**
 * Greedy selection of the top ~10k titles with diversity quotas.
 *
 * Hard caps (silently skip once hit):
 *   - max 25 titles per canonical author
 *   - max 12 titles per series
 *
 * Floor quotas (filled in a first greedy pass before the general pass):
 *   - >= 1,500 pre-2000 titles
 *   - >= 800 horror titles
 *   - >= 400 translations
 *   - >= 300 award winners from last 5 years
 */

import type { ScoredCandidate } from "./types";

const AUTHOR_CAP = 25;
const SERIES_CAP = 12;

export interface SelectionConfig {
  target: number;
  preYear: number;
  preYearFloor: number;
  horrorFloor: number;
  translationFloor: number;
  recentAwardsFloor: number;
  recentAwardsSinceYear: number;
}

export const DEFAULT_SELECTION: SelectionConfig = {
  target: 10_000,
  preYear: 2000,
  preYearFloor: 1_500,
  horrorFloor: 800,
  translationFloor: 400,
  recentAwardsFloor: 300,
  recentAwardsSinceYear: new Date().getFullYear() - 5,
};

interface Counters {
  byAuthor: Map<string, number>;
  bySeries: Map<number, number>;
  preYear: number;
  horror: number;
  translation: number;
  recentAwards: number;
}

export interface SelectionResult {
  selected: ScoredCandidate[];
  rejected: Array<{ candidate: ScoredCandidate; reason: string }>;
  stats: {
    total: number;
    selected: number;
    preYear: number;
    horror: number;
    fantasy: number;
    scifi: number;
    translation: number;
    recentAwardWinners: number;
    floorsMet: Record<string, boolean>;
  };
}

function candidateHasRecentAward(c: ScoredCandidate, sinceYear: number): boolean {
  return c.awards.some((a) => a.result === "won" && (a.year ?? 0) >= sinceYear);
}

function tryAdd(
  candidate: ScoredCandidate,
  counters: Counters,
  picked: Set<number>,
): { accepted: boolean; reason?: string } {
  if (picked.has(candidate.title_id)) {
    return { accepted: false, reason: "already_picked" };
  }

  const authorKey = candidate.canonical_author_name?.toLowerCase() ?? `__id_${candidate.canonical_author_id}`;
  const authorCount = counters.byAuthor.get(authorKey) ?? 0;
  if (authorCount >= AUTHOR_CAP) {
    return { accepted: false, reason: "author_cap" };
  }

  if (candidate.series_id !== null) {
    const seriesCount = counters.bySeries.get(candidate.series_id) ?? 0;
    if (seriesCount >= SERIES_CAP) {
      return { accepted: false, reason: "series_cap" };
    }
  }

  counters.byAuthor.set(authorKey, authorCount + 1);
  if (candidate.series_id !== null) {
    counters.bySeries.set(
      candidate.series_id,
      (counters.bySeries.get(candidate.series_id) ?? 0) + 1,
    );
  }
  picked.add(candidate.title_id);
  return { accepted: true };
}

export function selectTopN(
  candidates: ScoredCandidate[],
  config: SelectionConfig = DEFAULT_SELECTION,
): SelectionResult {
  const sorted = candidates.slice().sort((a, b) => b.seed_score - a.seed_score);

  const counters: Counters = {
    byAuthor: new Map(),
    bySeries: new Map(),
    preYear: 0,
    horror: 0,
    translation: 0,
    recentAwards: 0,
  };
  const picked = new Set<number>();
  const selected: ScoredCandidate[] = [];
  const rejected: Array<{ candidate: ScoredCandidate; reason: string }> = [];

  // Pass 1: satisfy floor quotas first.
  const floorPredicates: Array<[string, number, (c: ScoredCandidate) => boolean]> = [
    [
      "horror",
      config.horrorFloor,
      (c) => c.canonical_genre === "horror",
    ],
    [
      "preYear",
      config.preYearFloor,
      (c) => (c.publication_year ?? 0) > 0 && (c.publication_year ?? 0) < config.preYear,
    ],
    [
      "translation",
      config.translationFloor,
      (c) => c.translated,
    ],
    [
      "recentAwards",
      config.recentAwardsFloor,
      (c) => candidateHasRecentAward(c, config.recentAwardsSinceYear),
    ],
  ];

  for (const [name, floor, predicate] of floorPredicates) {
    let count = 0;
    for (const c of sorted) {
      if (count >= floor) break;
      if (selected.length >= config.target) break;
      if (!predicate(c)) continue;
      const res = tryAdd(c, counters, picked);
      if (res.accepted) {
        selected.push(c);
        count++;
        if (name === "horror") counters.horror++;
        if (name === "preYear") counters.preYear++;
        if (name === "translation") counters.translation++;
        if (name === "recentAwards") counters.recentAwards++;
      }
    }
  }

  // Pass 2: general fill.
  for (const c of sorted) {
    if (selected.length >= config.target) break;
    const res = tryAdd(c, counters, picked);
    if (res.accepted) {
      selected.push(c);
    } else if (res.reason && res.reason !== "already_picked") {
      rejected.push({ candidate: c, reason: res.reason });
    }
  }

  // Tally final stats.
  let horror = 0, fantasy = 0, scifi = 0, pre = 0, translated = 0, recentAw = 0;
  for (const c of selected) {
    if (c.canonical_genre === "horror") horror++;
    else if (c.canonical_genre === "fantasy") fantasy++;
    else if (c.canonical_genre === "sci-fi") scifi++;
    if ((c.publication_year ?? 0) > 0 && (c.publication_year ?? 0) < config.preYear) pre++;
    if (c.translated) translated++;
    if (candidateHasRecentAward(c, config.recentAwardsSinceYear)) recentAw++;
  }

  return {
    selected,
    rejected,
    stats: {
      total: candidates.length,
      selected: selected.length,
      preYear: pre,
      horror,
      fantasy,
      scifi,
      translation: translated,
      recentAwardWinners: recentAw,
      floorsMet: {
        horror: horror >= config.horrorFloor,
        preYear: pre >= config.preYearFloor,
        translation: translated >= config.translationFloor,
        recentAwards: recentAw >= config.recentAwardsFloor,
      },
    },
  };
}
