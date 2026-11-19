# Top-10k Seed Selection Strategy

How we pick the initial 10,000 sci-fi / fantasy / horror works that populate the galaxy on day one.

## Goal

A curated, diverse, critically-weighted seed that makes the universe **feel complete** on first render. These are shell records only — full metadata is lazy-enriched as users interact. See [`compounding-catalog.md`](./compounding-catalog.md).

Target shape: **~4,500 sci-fi / ~4,000 fantasy / ~1,500 horror** (adjusts after scoring — see quotas below).

---

## Sources (input)

### Primary: ISFDB MySQL dump (authoritative for sff)

Filters:
- `title_ttype IN ('NOVEL', 'COLLECTION', 'OMNIBUS', 'ANTHOLOGY', 'CHAPBOOK')`
  - Include CHAPBOOK to catch standalone novellas (e.g. *This Is How You Lose the Time War*)
- `title_language = 17` (English)
  - Exception: classic translations with English editions get boosted in step 3
- `title_parent = 0` (canonical titles only — skip variants/retitlings)
- `title_non_genre = 'No'` (skip general-fiction-by-sff-authors)
- Must have at least one `pubs` row with a non-null ISBN-13 (ensures we can link an edition)

Yields ~80,000–120,000 candidate titles.

### Popularity join: goodbooks-10k (frozen 2017)

- Already downloaded at `data/nebula/raw/books.csv` (used by existing seed)
- Join to ISFDB on ISBN-13 (primary) or ISBN-10 (fallback)
- Source of `goodreads_ratings_count` — strong readership proxy

### Tertiary signals (no extra fetching needed; all in the ISFDB dump)

- `title_awards` — Hugo, Nebula, World Fantasy, Locus, Bram Stoker, Shirley Jackson, BFA, Clarke, Dick
- `pub_content` / `pubs` — edition count per title = enduring-popularity proxy (reprints)
- `series` + `title_seriesnum` — identify series anchors
- `title_tags` — genre bucketing (`horror`, `sword and sorcery`, `space opera`, etc.)

---

## Scoring

Each candidate gets a composite `seed_score` in [0, 100]:

```
seed_score =
    0.35 * awards_signal
  + 0.25 * edition_signal
  + 0.20 * goodreads_signal
  + 0.10 * series_anchor_bonus
  + 0.07 * recency_signal
  + 0.03 * genre_canon_bonus
```

### Component definitions

**`awards_signal`** (normalised 0–1 within candidate set)
```
raw = 10 * wins + 3 * nominations
normalised = log1p(raw) / log1p(max(raw))
```
Awards include: Hugo Best Novel, Nebula, World Fantasy, Locus, Bram Stoker, Shirley Jackson, BFA, Clarke, Philip K. Dick, Mythopoeic, Newbery (sff), Tiptree/Otherwise.

**`edition_signal`** (reprints as enduring-popularity proxy)
```
raw = count(pubs WHERE title_id = t)
normalised = log1p(raw) / log1p(p99(raw))  // cap outliers at 99th pct
```

**`goodreads_signal`** (joined from goodbooks-10k)
```
raw = books.ratings_count  (0 if no join)
normalised = log1p(raw) / log1p(max(raw))
```

**`series_anchor_bonus`** — first book in a series of ≥3 published books gets 1.0; other series members 0.3; standalones 0.5. Stops later series from crowding out standalones.

**`recency_signal`** — modest boost for recent hits so the universe doesn't feel dated:
```
year >= 2020           → 1.0
year in 2015..2019     → 0.7
year in 2005..2014     → 0.5
year in 1990..2004     → 0.4
year < 1990            → 0.3
```

**`genre_canon_bonus`** — hand-picked list of ~200 consensus-canon titles (e.g., Dune, LOTR, Haunting of Hill House) get +1.0. Prevents the scoring from accidentally missing universally-recognised works with weaker modern signal. List lives at `data/nebula/seed/canon.jsonl`.

---

## Selection algorithm (after scoring)

Greedy selection with diversity quotas, in this order:

1. **Sort candidates by `seed_score` descending.**
2. **Apply hard caps** (skip candidates that would violate):
   - Max **25 titles per author** (Stephen King, Sanderson, Asimov cap — keeps the universe diverse)
   - Max **12 titles per series** (skip later entries in very long series — Dragonlance, Discworld, WoT etc.)
3. **Apply floor quotas** (reserve slots so small buckets aren't drowned):
   - ≥ **1,500 titles published before 2000** (classics protection)
   - ≥ **800 horror-tagged titles** (horror under-indexes on popularity scoring)
   - ≥ **400 titles translated into English** (Lem, Zamyatin, Liu, Sapkowski, Tchaikovsky pre-English era, etc.)
   - ≥ **300 award winners from the last 5 years** (currency)
4. **Fill remaining slots** from the unused top of the sorted list until 10,000.

The floors are implemented by running the greedy pass twice: once for quota-reserved buckets, then once for general fill.

---

## Genre classification (for bucket quotas + `canonical_genre` on the shell)

Classifier runs over ISFDB tags, falling back to keyword rules:

| Bucket | Triggering tags (ISFDB) | Keyword fallback |
|---|---|---|
| **horror** | `horror`, `cosmic horror`, `ghost stories`, `supernatural horror`, `psychological horror`, `slasher`, `weird fiction` | "haunt" "ghost" "vampire" "werewolf" "zombie" in title |
| **sci-fi** | `science fiction`, `space opera`, `hard sf`, `cyberpunk`, `dystopian`, `post-apocalyptic`, `military sf`, `time travel`, `first contact`, `climate fiction` | "space" "robot" "AI" "Mars" "galaxy" |
| **fantasy** | `fantasy`, `epic fantasy`, `urban fantasy`, `sword and sorcery`, `high fantasy`, `grimdark`, `portal fantasy`, `mythic fantasy`, `fairy tale`, `magic school` | "magic" "dragon" "wizard" "elf" "kingdom" |

Tie-break order when tags suggest multiple: **horror > sci-fi > fantasy** (horror loses otherwise because the sff authors overlap).

Every seed row gets exactly one `canonical_genre` (for galaxy region placement). Secondary tags go into `nb_book_tags`.

---

## Pipeline stages (code layout)

```
scripts/nebula/seed-top-10k/
  01-download-isfdb.ts       # gdown the latest MySQL backup (reuse lib from plan 00310)
  02-load-mysql.ts            # docker mysql:8 + restore
  03-extract-candidates.ts    # SQL JOIN titles × pubs × title_awards × title_tags → candidates.jsonl
  04-join-goodbooks.ts        # enrich candidates with goodreads_ratings_count
  05-score.ts                 # compute seed_score components and composite
  06-classify-genre.ts        # sff/fantasy/horror bucketing
  07-select.ts                # greedy selection + diversity quotas → top_10k.jsonl
  08-build-csv.ts             # emit data/nebula/sff_horror_top_10k.csv (schema matches existing loader)
  09-seed-coords.ts           # deterministic hash-based coords per (genre, author) → seeded coords
  10-load.ts                  # idempotent upsert into nb_books + nb_editions + nb_enrichment_status
```

Each stage is independently runnable and writes its output to `data/nebula/seed/<stage>/`.

## CSV schema (inputs to `10-load.ts`)

```
canonical_title,primary_author,series_name,series_order,publication_year,
isbn_10,isbn_13,cover_url,page_count,language,
canonical_genre,sub_genre,popularity_score,seed_score,
tags,awards,source_list,
isfdb_title_id,isfdb_author_id,isfdb_series_id,goodreads_id
```

Notes on fields:
- `popularity_score` = the final `seed_score` × 100, clamped to int for storage
- `cover_url` = populated later by the cover job (OpenLibrary Covers); left empty at seed if unknown
- `source_list` = comma-separated provenance (e.g. `"isfdb,goodbooks-10k,hugo-winner"`)
- Description / short_description are **intentionally blank** — filled by the metadata enrichment job on first interaction

## Loader behaviour (`10-load.ts`)

For each row in the CSV:

1. Dedupe against existing `nb_books`:
   - Match on `external_ids.isfdb.title_id` first
   - Then on ISBN-13 via `nb_editions`
   - Then on normalised title + author surname
2. If match: **merge missing fields only** (COALESCE — never overwrite existing values from the previous Goodbooks-10k seed without a `--force` flag)
3. If no match: insert new `nb_books` shell
4. Insert `nb_editions` row for the CSV's canonical ISBN-13
5. Insert `nb_enrichment_status` with `metadata_status='shell'`, `embedding_status='shell'`, `coords_status='seeded'`
6. Insert `nb_book_authors` (primary author only — multi-author resolved during enrichment)
7. Insert `nb_series` + link if applicable
8. Record provenance in `nb_source_records` with `provider='isfdb_seed'`, `payload=<original CSV row>`
9. Seeded coordinates computed deterministically (see next section)

The loader is idempotent: re-running it must be a no-op for already-seeded works.

## Seeded coordinate rule

```
hash = SHA256(canonical_genre + "|" + primary_author)
region_offset_angle = (hash[0..3] / 0xFFFF) * 2π
region_offset_radius = (hash[4..7] / 0xFFFF) * region_cloud_radius
jitter_z = (hash[8..11] / 0xFFFF - 0.5) * 0.3

x = region.anchor_x + cos(angle) * radius
y = region.anchor_y + sin(angle) * radius
z = region.anchor_z + jitter_z
```

Same book ingested twice gets the same coords. Same author's books cluster by construction. Later embedding-based refinement is region-local and bounded by `local_radius`.

---

## Risks & how we mitigate

- **ISBN coverage gaps** — some ISFDB titles lack modern ISBN-13 editions (pre-ISBN era). We require an ISBN-13 on at least one pub to be seedable; the long tail of ISBN-less titles is excluded from v1 (they'll arrive via user upload if relevant).
- **Horror under-representation** — ISFDB is historically sf-heavy. The 800-floor quota + Bram Stoker / Shirley Jackson weighting corrects this.
- **Series dominance** — the 12-per-series cap prevents Dragonlance / Forgotten Realms / Star Wars expanded universe from flooding the seed.
- **Author dominance** — 25-per-author cap. Sanderson, King, Asimov, Heinlein will hit this and their lesser works get dropped to the lazy-enrichment tail.
- **Goodbooks-10k frozen 2017** — we accept staleness here; modern hits come via the recency_signal and award boost.
- **Licence: goodbooks-10k is CC BY-SA 4.0.** We use it only as a ranking signal; none of its text is redistributed. Composite derived scores are fine.
- **Licence: ISFDB is CC BY 4.0.** We attribute in the UI footer and re-paraphrase any synopses before display (handled by the enrichment job, not the seed).

---

## Verification (after seed load)

Fixture assertions run by `scripts/nebula/seed-top-10k/verify.ts`:

- Exactly 10,000 `nb_books` rows with `external_ids ? 'isfdb'` (existence proof).
- Every seed row has a `nb_book_coordinates` entry with `layout_version = 'v1'`.
- Every seed row has a `nb_enrichment_status` row with `metadata_status = 'shell'`.
- Genre distribution within 10% of target: 45/40/15 ± 5.
- No author contributes more than 25 titles.
- No series contributes more than 12 titles.
- 20-book fixture present (Dune, Hyperion, Neuromancer, LOTR:Fellowship, Haunting of Hill House, The Shining, House of Leaves, Gideon the Ninth, Piranesi, The Fifth Season, Foundation, Left Hand of Darkness, Earthsea: A Wizard of Earthsea, The Lies of Locke Lamora, Perdido Street Station, Ancillary Justice, Annihilation, The Three-Body Problem, Dracula, Frankenstein).
- Manual: open the galaxy and eyeball region balance — no single region >15% of points.

---

## Refresh policy

This seed runs **once at MVP launch**. After that, the galaxy grows via user interaction (lazy enrichment) and the 6-monthly ISFDB gap-fill refresh (Phase F). Re-running the full seed is not a routine operation — it would re-seed already-enriched works and potentially jitter coords, which we never want in production.
