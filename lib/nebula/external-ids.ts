/**
 * Typed helpers for the `external_ids` JSONB column on nb_books / nb_authors /
 * nb_series (and legacy books / authors). Convention:
 *
 *   {
 *     "isfdb": { "title_id": 12345, "alt_author_ids": [99,100], "synopsis_source": "isfdb:title:12345" },
 *     "openlibrary": { "key": "/works/OL123W" }
 *   }
 *
 * All getters tolerate missing / malformed payloads and return undefined.
 */

export type Provider = "isfdb" | "openlibrary" | "google_books" | "goodreads" | "sffrd" | "llm" | "user";

export interface IsfdbBookIds {
  title_id?: number;
  alt_title_ids?: number[];
  synopsis_source?: string;
}

export interface IsfdbAuthorIds {
  author_id?: number;
  alt_author_ids?: number[];
}

export interface IsfdbSeriesIds {
  series_id?: number;
}

export type ExternalIds = {
  [P in Provider]?: Record<string, unknown>;
};

// --- Generic helpers ---

export function getProviderIds<T = Record<string, unknown>>(
  external: ExternalIds | null | undefined,
  provider: Provider,
): T | undefined {
  if (!external || typeof external !== "object") return undefined;
  const node = external[provider];
  return node && typeof node === "object" ? (node as T) : undefined;
}

/**
 * Deep-merge incoming provider ids on top of existing, producing a new object.
 * Arrays are unioned + de-duplicated. Scalars from `incoming` win.
 * Providers not present in `incoming` are preserved from `existing` verbatim.
 */
export function mergeExternalIds(
  existing: ExternalIds | null | undefined,
  incoming: ExternalIds | null | undefined,
): ExternalIds {
  const out: ExternalIds = { ...(existing ?? {}) };
  if (!incoming) return out;

  for (const key of Object.keys(incoming) as Provider[]) {
    const prev = (out[key] ?? {}) as Record<string, unknown>;
    const next = (incoming[key] ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...prev };

    for (const field of Object.keys(next)) {
      const a = prev[field];
      const b = next[field];
      if (Array.isArray(a) && Array.isArray(b)) {
        merged[field] = Array.from(new Set([...a, ...b]));
      } else if (b !== undefined && b !== null) {
        merged[field] = b;
      }
    }

    out[key] = merged;
  }

  return out;
}

// --- ISFDB-specific typed accessors ---

export function getIsfdbTitleId(external: ExternalIds | null | undefined): number | undefined {
  return getProviderIds<IsfdbBookIds>(external, "isfdb")?.title_id;
}

export function getIsfdbAuthorId(external: ExternalIds | null | undefined): number | undefined {
  return getProviderIds<IsfdbAuthorIds>(external, "isfdb")?.author_id;
}

export function getIsfdbSeriesId(external: ExternalIds | null | undefined): number | undefined {
  return getProviderIds<IsfdbSeriesIds>(external, "isfdb")?.series_id;
}

export function setIsfdbBookIds(
  existing: ExternalIds | null | undefined,
  ids: IsfdbBookIds,
): ExternalIds {
  return mergeExternalIds(existing, { isfdb: ids as Record<string, unknown> });
}

export function setIsfdbAuthorIds(
  existing: ExternalIds | null | undefined,
  ids: IsfdbAuthorIds,
): ExternalIds {
  return mergeExternalIds(existing, { isfdb: ids as Record<string, unknown> });
}

export function setIsfdbSeriesIds(
  existing: ExternalIds | null | undefined,
  ids: IsfdbSeriesIds,
): ExternalIds {
  return mergeExternalIds(existing, { isfdb: ids as Record<string, unknown> });
}
