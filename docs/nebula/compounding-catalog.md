# The Compounding Catalog — Living Library's Shared, Lazy-Enriched Book Database

This is the architectural source of truth for how books enter, update, and improve inside the Living Library database. It supersedes the earlier "ISFDB-exhaustive import" direction.

---

## Principle

> **Every work is a shell that gets richer as the community interacts with it. We save enrichment centrally so every future user benefits.**

Three layered rules:

1. **Galaxy-ready shells on day one** — every work in the universe has the minimum data to render as a visible point (title, author, genre, coords, popularity). Nothing more.
2. **Enrichment is lazy, triggered by attention** — the full description, tags, awards, editions, covers, embeddings, feature scores are fetched only when a user clicks / searches / uploads / scans that work.
3. **Writes compound** — enrichment from user A's interaction is visible to user B on their next read. There is no per-user cache layer to defeat this.

---

## Why not the alternatives

| Approach | Why rejected |
|---|---|
| **Full upfront ingest** (300k+ ISFDB titles, all fields) | 95%+ of records would never be viewed. Embedding + scoring cost wasted. Every schema change becomes a massive migration. Slow to ship. |
| **Pure on-demand** (empty galaxy, populate on first search) | The galaxy visual is the product. A sparse universe on first render breaks the "exploring space" promise. Loses the wow moment. |
| **Compounding catalog** ✓ | Fast galaxy from shells. Cost scales with real engagement. Popular books naturally stay fresh. Long-tail stays shallow, which is correct. |

---

## Data model (tables of record)

Full schemas in migrations `00100`, `00300`, `00310`. Logical roles:

| Table | Role | Decay rate |
|---|---|---|
| `nb_books` | Canonical *work* — the shell, plus enriched metadata once available | Slow (6–12 mo) |
| `nb_editions` | ISBN-level publications attached to a work | Slow |
| `nb_authors` | Author records with `external_ids` JSONB | Slow |
| `nb_series` | Series records with `external_ids` JSONB | Slow |
| `nb_book_tags` | Tags with `source` column (`isfdb` \| `openlibrary` \| `llm` \| `user`) | Slow |
| `nb_book_awards` | Awards from ISFDB / Wikidata | Slow |
| `nb_book_embeddings` | Vector + `input_hash` for delta re-embedding | Derived |
| `nb_book_coordinates` | 3D galaxy position; has `layout_version` | Derived |
| `nb_book_features` | 10-axis LLM feature scores | Derived |
| `nb_source_records` | Raw provider payloads, append-only provenance | Never expires |
| `nb_enrichment_status` | Per-work state machine per concern (metadata / embedding / coords / cover) | Reflects other tables |
| `nb_enrichment_jobs` | Postgres-as-queue for async work | — |
| `nb_popularity_signals` | Append-only user engagement tallies | Continuous |
| `nb_pricing_snapshots` | Volatile pricing, separate from canonical record | Fast (hours) |
| `nb_user_books` | User's ownership/read state | User-owned |

**Principle**: fields that decay at different rates live in different tables. Pricing never shares storage with bibliographic metadata.

---

## Source-of-truth map (which provider wins, per field)

Left-to-right fallback. First hit populates the canonical column; lower-tier sources fill gaps only via `COALESCE(existing, incoming)`.

| Field | 1st | 2nd | 3rd | Last resort |
|---|---|---|---|---|
| `title` | ISFDB | OpenLibrary | Google Books | User input |
| `primary_author` | ISFDB `canonical_author` | OpenLibrary | Google Books | User input |
| `publication_year` | ISFDB `title_copyright` | OpenLibrary `first_publish_year` | Google Books `publishedDate` | — |
| `description` | ISFDB `title_synopsis` → **LLM paraphrase** | OpenLibrary → LLM paraphrase | Google Books → LLM paraphrase | LLM from title+author |
| `cover_image_url` | OpenLibrary Covers (by ISBN) | ISFDB cover | Google Books thumbnail | — |
| `series_id` + `series_order` | ISFDB `series` | OpenLibrary series (unreliable) | — | — |
| `canonical_genre` | ISFDB tags → genre mapper | OpenLibrary subjects → mapper | LLM inference | `'unknown'` |
| `awards` | ISFDB `title_awards` | Wikidata `P166` | — | — |
| `author_bio` / birth / death | Wikidata (via QID) | OpenLibrary `/authors/OL..A.json` | ISFDB bio | LLM |
| `edition.isbn_13` / `isbn_10` | ISFDB `pubs.pub_isbn` | OpenLibrary editions | Google Books `industryIdentifiers` | User scan |
| `edition.page_count` | ISFDB `pubs.pub_pages` | OpenLibrary | Google Books | — |
| `edition.publisher` | ISFDB | OpenLibrary | Google Books | — |
| `edition.format` | ISFDB `pub_ctype` | OpenLibrary `physical_format` | Google Books `printType` | — |
| `tags` | ISFDB `title_tags` | OpenLibrary subjects | LLM-derived | — |
| `feature_scores` (10-axis) | **LLM over description + tags** | — | — | — |
| `embedding` | **OpenAI `text-embedding-3-small`** | — | — | — |
| `popularity_score` (seed) | goodbooks-10k + ISFDB awards | — | — | 0 |
| `engagement_score` (live) | **in-app signals** | — | — | 0 |
| `related_works` | `nb_book_embeddings` nearest-neighbours | ISFDB series | co-upload signal | — |
| `pricing_cents` | Amazon PA-API (Phase F) | Abebooks | ISBNdb | User-reported |
| `rating_average` | In-app user ratings | OpenLibrary ratings | Google Books | null |

### Provider reality check

| Provider | Licence | Status for us |
|---|---|---|
| **ISFDB** | CC BY 4.0, full MySQL dump via Google Drive | Primary for sff. Local, queried by the worker. |
| **OpenLibrary** | CC0, free unlimited API | Primary for general + fallback. Rate-limit: 1 rps default, 3 rps with identified UA. Cache aggressively. |
| **OpenLibrary Covers** | CC0, public CDN | Primary for covers. Respect "no crawling" guidance — only fetch on demand. |
| **Google Books** | Proprietary, display-only | Safe as fallback when OpenLibrary is thin. Requires API key, 1k req/day free tier. |
| **Wikidata** | CC0, free SPARQL | Great for author bios, awards. Underused. |
| **Goodreads** | API killed Dec 2020 | ❌ No programmatic access. Do not scrape. |
| **goodbooks-10k** | CC BY-SA 4.0, frozen 2017 | Use once for popularity seeding only. |
| **Amazon PA-API** | TOS-bound, requires affiliate approval | Phase F only. |
| **ISBNdb** | Paid (~$20–50/mo) | Only if needed. |

### Copyright / display rules

- **Never display raw copyrighted text.** Descriptions from any external provider are paraphrased by an LLM before being stored in `nb_books.short_description`. Raw payloads stay in `nb_source_records` for provenance and audit only.
- **Attribute** every source-backed field in the UI footer (e.g. "Metadata from ISFDB, CC BY 4.0").
- **Non-null authoritative fields never get overwritten** by lower-tier sources without an explicit `--force-overwrite` flag.

---

## Behaviour per user action (explicit call sequences)

### (A) User clicks a book already in the galaxy

```
sync (<200ms):
  1. SELECT nb_books + nb_enrichment_status WHERE id = $work_id
  2. Render shell + whatever's cached
  3. Emit popularity signal (type='view')

async (if metadata_status in ('shell','stale')):
  4. Upsert nb_enrichment_jobs (work_id, 'metadata', priority=10)
  5. Worker runs chain:
       a. external_ids.isfdb.title_id known → query local ISFDB dump
       b. Else OpenLibrary /works/{key}.json or title+author search
       c. Else Google Books volumes?q=intitle:...inauthor:...
       d. Paraphrase synopsis (LLM)
       e. Fetch cover via OpenLibrary Covers if missing
  6. Merge (COALESCE rules), write nb_books + nb_source_records
  7. Update nb_enrichment_status, broadcast Supabase realtime
  8. Client patches detail panel in place

async (if embedding_status='shell' OR input_hash mismatches):
  9. Enqueue ('embedding', priority=50) → OpenAI → nb_book_embeddings
  10. Enqueue ('coords', priority=60) → refine within current region only
```

### (B) User searches by title (free text)

```
sync:
  1. Trigram: SELECT id, title, author FROM nb_books
     WHERE title % $q OR similarity(title, $q) > 0.3
     ORDER BY similarity(title, $q) DESC, engagement_score DESC
     LIMIT 20
  2. Render results instantly

async:
  3. Record 'search_hit' signal for each displayed work

opt-in (if zero results above threshold):
  4. Show "Not in your universe yet — add it?" CTA (do NOT silently insert)
  5. On confirm: route to (E)
```

### (C) User searches by ISBN or scans a barcode

```
sync (<600ms):
  1. Normalise ISBN-10 ↔ 13 via lib/nebula/title-normalise.ts
  2. SELECT nb_editions WHERE isbn_13=$x OR isbn_10=$y
  3. Hit: return parent work_id → (A)
  4. Miss:
       a. OpenLibrary /isbn/$isbn.json (~300ms)
       b. Miss → Google Books /volumes?q=isbn:$isbn (~200ms)
       c. Miss → "not found" to user
  5. On success:
       a. Dedupe: find existing work by (normalised_title + author_surname)
       b. Found: INSERT nb_editions attached to that work
       c. Else: INSERT nb_books (shell) + nb_editions + seeded coords
       d. INSERT nb_enrichment_status (metadata_status='shell')
       e. Enqueue ('metadata', priority=10) and ('embedding', priority=50)
  6. Return work to user (shell is enough to render)
```

### (D) User uploads a book (manual / CSV / photo)

```
sync:
  1. Normalise identifiers (ISBN, title, author)
  2. Dedupe chain:
       a. Exact nb_editions.isbn_13 → parent work
       b. Exact nb_editions.isbn_10 → parent work
       c. Trigram (norm_title + author_surname) sim ≥ 0.78 → existing work
       d. 0.60–0.78 → create shell + flag for review queue
       e. <0.60 → new shell work
  3. Always INSERT nb_user_books
  4. Emit 'upload' popularity signal (weight=5)
  5. Return success + detail panel

async:
  6. New work → enqueue ('metadata', priority=10)
  7. ISBN present, no edition → enqueue cover fetch
  8. Recompute engagement_score
```

### (E) User adds something not in seed universe

```
sync (during CTA flow):
  1. OpenLibrary /search.json?title=$t&author=$a
  2. 0 results → Google Books fallback
  3. Present top 3 candidates (avoid phantom creation)
  4. On confirm:
       a. Fetch /works/{key}.json
       b. Create nb_books shell + seeded coords + nb_enrichment_status
       c. Enqueue metadata + embedding + coords
  5. Render in galaxy with subtle "new" marker
```

### (F) Enrichment returns richer data than current state

Not a user action — an async outcome. Rules:

- Field-by-field merge with `COALESCE(existing, incoming)`
- Authoritative sources (ISFDB) beat general (OpenLibrary) beat commercial display-only (Google Books) beat LLM-derived beat null
- Provenance in `nb_source_records` (raw payload) + `nb_books.external_ids` (keyed ids)
- If `description` changes: re-run LLM paraphrase → new `input_hash` → flag `embedding_status='stale'` → triggers re-embed
- If coords-relevant fields change (`canonical_genre`, description, tags): enqueue (`coords`, priority=60)
- **Never overwrite user-edited fields** without explicit provenance

---

## Coordinate stability

Two systems, intentionally separated:

### Seeded coords (deterministic, immediate, applied to every new shell)

- Hash on `(canonical_genre, author_name)` → offset within the region's anchor cluster
- Deterministic: same seed → same coords → stable across re-runs
- No one ever sees a coordless book

### Refined coords (embedding-based, async, local-only)

- Runs only when `input_hash` changes OR work has been viewed > N times
- **Operates within the book's current region** — never teleports across the galaxy
- Rubber-band constraint: can't move more than `local_radius` from seeded position

### Stability mechanisms

- **Layout versioning**: `nb_book_coordinates.layout_version`. Galaxy reads from current version; v2 computed offline and atomic-bumped.
- **Anchor locking**: series anchor books and their first-ring neighbours never move.
- **Delta scope**: refining one book's coords triggers no other recomputation.
- **Never** do a full universe re-layout in production.

---

## Engagement & popular-path promotion

- `nb_popularity_signals` is append-only, one row per event.
- A rollup job every 10 minutes computes `nb_books.engagement_score` from the last 90 days of signals, weighted: `upload=5, wishlist=3, read=3, click=1, view=0.3, search_hit=0.1`.
- The galaxy LOD reads `engagement_score` to decide which books are visible at galaxy-zoom vs constellation-zoom vs star-zoom.
- Works crossing a threshold (e.g. `engagement_score > 50`) get **promoted**: their `metadata_next_refresh_at` is pulled forward to quarterly instead of annual. Popularity drives quality.

---

## What's explicitly NOT in this system

- **User-specific caches** — would defeat the "save once, benefit everyone" property.
- **Silent record creation from search** — creates phantom works and degrades galaxy quality. Always ask ("Add to your universe?").
- **Inline LLM calls on every view** — paraphrase runs once per source change and is cached forever.
- **Global coordinate recomputation in production** — breaks visual stability.
- **Pricing in `nb_books`** — volatile, belongs in `nb_pricing_snapshots` only.
