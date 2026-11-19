"use server";

import { fuzzyMatch, type OLSearchResult } from "@/lib/open-library";
import type { SpineResult } from "@/app/actions/scan-spine";

export interface MatchedBook {
  spine: SpineResult;
  match: OLSearchResult | null;
  selected: boolean;
}

export async function matchSpines(
  spines: SpineResult[]
): Promise<{ matched: MatchedBook[] }> {
  const matched: MatchedBook[] = [];

  // Process in batches of 3 to avoid hammering Open Library
  for (let i = 0; i < spines.length; i += 3) {
    const batch = spines.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (spine) => {
        const match = await fuzzyMatch(spine.title, spine.author);
        return {
          spine,
          match,
          selected: match !== null, // pre-select matched, deselect unmatched
        };
      })
    );
    matched.push(...results);
  }

  return { matched };
}
