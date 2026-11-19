/**
 * Source-tier precedence merge for canonical book fields.
 *
 * Tier ordering (lower = higher priority):
 *   user (0) < isfdb (1) < openlibrary (2) < google_books (3) < llm (4)
 *
 * Rules per field:
 *   1. If existing is null/empty → accept incoming regardless of tier.
 *   2. If incoming tier < existing tier (better source) → accept incoming.
 *   3. If incoming tier >= existing tier → reject (gap-fill only).
 *   4. Tier 0 (user edits) is never overwritten.
 */

import type { ProviderName, ProviderRecord, ProviderFields } from "./enrichment-client";

export const SOURCE_TIER: Record<ProviderName, number> = {
  user: 0,
  isfdb: 1,
  openlibrary: 2,
  google_books: 3,
  llm: 4,
};

export type ProvenanceEntry = { tier: number; provider: ProviderName };
// Includes derived fields like `short_description` (LLM) that aren't on ProviderFields.
export type ProvenanceKey = keyof ProviderFields | "short_description";
export type Provenance = Partial<Record<ProvenanceKey, ProvenanceEntry>>;

export interface MergeInput {
  existing: Partial<Record<keyof ProviderFields, unknown>>;
  existingProvenance: Provenance;
  incoming: ProviderRecord;
}

export interface MergeOutput {
  patch: Partial<Record<keyof ProviderFields, unknown>>;
  newProvenance: Provenance;
  accepted: (keyof ProviderFields)[];
  rejected: (keyof ProviderFields)[];
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export function mergeBookFields({ existing, existingProvenance, incoming }: MergeInput): MergeOutput {
  const tier = SOURCE_TIER[incoming.provider];
  const patch: Partial<Record<keyof ProviderFields, unknown>> = {};
  const newProvenance: Provenance = { ...existingProvenance };
  const accepted: (keyof ProviderFields)[] = [];
  const rejected: (keyof ProviderFields)[] = [];

  const fieldKeys = Object.keys(incoming.fields) as (keyof ProviderFields)[];
  for (const field of fieldKeys) {
    const incomingValue = incoming.fields[field];
    if (isEmpty(incomingValue)) continue;

    const existingValue = existing[field];
    // Unprovenanced non-null values are treated as tier=openlibrary so a fresh
    // openlibrary hit ties and loses. Only better-tier sources (ISFDB, user)
    // can displace seed/legacy data. Null values fall through to gap-fill.
    const existingTier =
      existingProvenance[field]?.tier ??
      (isEmpty(existingValue) ? Infinity : SOURCE_TIER.openlibrary);

    // Never overwrite user edits.
    if (existingTier === SOURCE_TIER.user && !isEmpty(existingValue)) {
      rejected.push(field);
      continue;
    }

    // Gap-fill.
    if (isEmpty(existingValue)) {
      patch[field] = incomingValue;
      newProvenance[field] = { tier, provider: incoming.provider };
      accepted.push(field);
      continue;
    }

    // Better source wins.
    if (tier < existingTier) {
      patch[field] = incomingValue;
      newProvenance[field] = { tier, provider: incoming.provider };
      accepted.push(field);
      continue;
    }

    rejected.push(field);
  }

  return { patch, newProvenance, accepted, rejected };
}
