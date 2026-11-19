/**
 * Attribution derivation. Reads `external_ids.provenance` on an nb_books row
 * and returns a user-friendly sources summary. No React — pure function, can
 * be called from server components or server actions.
 */

export interface ProviderAttribution {
  id: "isfdb" | "openlibrary" | "google_books" | "wikidata" | "llm" | "user";
  label: string;
  licence: string | null;
  href: string | null;
  fields: string[];
}

const PROVIDER_META: Record<
  ProviderAttribution["id"],
  { label: string; licence: string | null; href: string | null }
> = {
  isfdb: {
    label: "ISFDB",
    licence: "CC BY 4.0",
    href: "https://creativecommons.org/licenses/by/4.0/",
  },
  openlibrary: {
    label: "OpenLibrary",
    licence: "CC0",
    href: "https://openlibrary.org/developers",
  },
  google_books: {
    label: "Google Books",
    licence: null,
    href: "https://developers.google.com/books/terms",
  },
  wikidata: {
    label: "Wikidata",
    licence: "CC0",
    href: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  llm: {
    label: "AI-generated",
    licence: null,
    href: null,
  },
  user: {
    label: "User-provided",
    licence: null,
    href: null,
  },
};

type ProvenanceEntry = { tier: number; provider: string };
type ProvenanceMap = Record<string, ProvenanceEntry>;

export function formatAttribution(
  externalIds: Record<string, unknown> | null | undefined,
): ProviderAttribution[] {
  if (!externalIds || typeof externalIds !== "object") return [];
  const provenance = (externalIds.provenance as ProvenanceMap | undefined) ?? {};

  const byProvider = new Map<ProviderAttribution["id"], string[]>();
  for (const [field, entry] of Object.entries(provenance)) {
    if (!entry?.provider) continue;
    const id = entry.provider as ProviderAttribution["id"];
    if (!PROVIDER_META[id]) continue;
    const arr = byProvider.get(id) ?? [];
    arr.push(field);
    byProvider.set(id, arr);
  }

  // Order: ISFDB first (tier 1 authoritative), then OpenLibrary, Google, Wikidata, LLM, User.
  const order: ProviderAttribution["id"][] = [
    "isfdb",
    "openlibrary",
    "google_books",
    "wikidata",
    "llm",
    "user",
  ];
  return order
    .filter((id) => byProvider.has(id))
    .map((id) => ({
      id,
      ...PROVIDER_META[id],
      fields: byProvider.get(id) ?? [],
    }));
}

/** One-line human-readable summary — "Metadata from ISFDB (CC BY 4.0), OpenLibrary. Description paraphrased." */
export function attributionSummary(
  externalIds: Record<string, unknown> | null | undefined,
): string {
  const items = formatAttribution(externalIds);
  if (items.length === 0) return "";
  const hasLLM = items.some((i) => i.id === "llm");
  const providerBits = items
    .filter((i) => i.id !== "llm" && i.id !== "user")
    .map((i) => (i.licence ? `${i.label} (${i.licence})` : i.label));
  const parts: string[] = [];
  if (providerBits.length > 0) parts.push(`Metadata from ${providerBits.join(", ")}.`);
  if (hasLLM) parts.push("Description paraphrased.");
  return parts.join(" ");
}
