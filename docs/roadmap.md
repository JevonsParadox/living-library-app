# Living Library — Roadmap

**Source of truth for what's built, what's next, and what's deferred.** Update this file when tasks complete or direction changes. Future sessions should read this first.

Last updated: 2026-05-18
Current architecture doc: [`docs/nebula/compounding-catalog.md`](./nebula/compounding-catalog.md)
Seed selection strategy: [`docs/nebula/seed-10k-selection.md`](./nebula/seed-10k-selection.md)

---

## Catalog snapshot (post Phase E.4)

Quick numbers so future sessions don't have to derive them.

| Metric | Value |
|---|---|
| Total books in `nb_books` | 12,785 |
| Books with ISFDB provenance (`external_ids.isfdb.title_id`) | 9,504 |
| Books with feature scores (`nb_book_features`) | 12,725 |
| Books with refined coords | 12,725 |
| Editions in `nb_editions` | 9,502+ |
| Awards in `nb_book_awards` | 7,223+ |
| Series clustered | 232 |
| Pending enrichment jobs (paraphrase + metadata + cascades) | ~12,000 — drains via cron post-deploy |
| Genre split | 38% sci-fi · 52% fantasy · 9% horror |

## Capabilities shipped end-to-end

- **Catalog**: shell-on-day-one + lazy enrichment via Postgres-as-queue worker (5 job types: metadata / paraphrase / cover / embedding / coords)
- **Sources**: ISFDB (CC BY 4.0) → OpenLibrary → Google Books, with 4-tier source-precedence merge policy and per-field provenance
- **Search**: in-memory client filter + pg_trgm server fallback + zero-result Add-to-Universe CTA
- **ISBN / barcode**: editions table lookup → external provider → shell creation; never dead-ends
- **Add-to-Universe**: dialog with provider candidates, dedupe via embedding+trigram, realtime fade-in to galaxy
- **Book detail**: realtime patches via Supabase realtime — "Enriching…" shimmer fades when worker completes
- **Engagement**: signals → 90-day weighted rollup → blended LOD (popularity 0.8 + engagement 0.2) drives star size + visibility
- **Quality**: admin review queue with atomic `nb_merge_works` RPC + audit script seeding likely-duplicate pairs
- **Legal**: site-wide CC BY 4.0 attribution footer, per-book Sources block, LLM-paraphrased descriptions only
- **UX polish**: click-only series labels, region-fixed spacing slider (4× default, 0.5×–5×)

---

## Strategic decision pending

The compounding catalog is feature-complete and verified. Two viable next moves:

**Path A — Deploy first**
Ship to Vercel, get cron pacing the enrichment backlog under real conditions, get a live URL for testing. Phase F items happen post-deploy with real user feedback.

**Path B — Plan a new feature first**
If a forthcoming feature reshapes the surface area (e.g. uses awards, ratings, series, criticism in a non-trivial way), plan it now rather than retrofit later. Easier to design against an unshipped surface.

Recommendation: **Path B** if there's a substantial feature in mind; otherwise **Path A** to unlock real-world feedback.

---

## Architecture direction (locked)

Living Library's book catalog is a **shared, compounding database**:

1. Every work has a lightweight **shell** record (title, author, genre, coords, popularity) from day one.
2. The galaxy renders from shells — no shell, no visible book.
3. **Deep enrichment is lazy**, triggered by user interaction (click / search / upload / scan).
4. Enrichment is written back centrally, so every subsequent user benefits.
5. **Work, edition, and pricing are separate tables** — they decay at different rates and must not share storage.
6. Primary data sources (per field) are defined in [`docs/nebula/compounding-catalog.md`](./nebula/compounding-catalog.md).

---

## Phase status

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` deferred/cancelled

### Phase A — Foundations

Schema + helpers for the compounding catalog. No user-facing changes.

- [x] Migration 00300 — `external_ids` on `nb_books`/`nb_authors`/`nb_series`/`books`/`authors`, pg_trgm, `nb_external_source_runs`, `nb_book_awards`
- [x] Migration 00310 — `nb_editions`, `nb_source_records`, `nb_enrichment_status`, `nb_enrichment_jobs`, `nb_popularity_signals`, `nb_pricing_snapshots`, `nb_books.engagement_score`
- [x] `lib/nebula/title-normalise.ts` — normalisation + ISBN-10↔13 conversion
- [x] `lib/nebula/external-ids.ts` — typed getters/setters + `mergeExternalIds`
- [x] Apply migrations 00300 + 00310 to Supabase (dashboard paste, 2026-04-22); backfill populated `nb_enrichment_status` as expected
- [x] Commit A checkpoint (`e396be1`)

### Phase B — Enrichment plumbing

The worker + enrichment clients that make compounding actually work.

- [x] Migration 00320 — `nb_claim_enrichment_jobs` RPC with `FOR UPDATE SKIP LOCKED`, `last_heartbeat` column
- [x] `lib/nebula/enrichment-client.ts` — OpenLibrary + Google Books fetchers (ISFDB stub for Phase C), token-bucket rate limiter, LRU cache
- [x] `lib/nebula/dedupe.ts` — `resolveWork` with ISBN → normalised-key → Dice-coefficient fallback
- [x] `lib/nebula/merge-policy.ts` — source-tier merge with per-field provenance (seed values protected)
- [x] `lib/nebula/worker.ts` + `scripts/nebula/run-enrichment-worker.ts` — RPC-claim loop, concurrency-limited dispatch, exponential backoff
- [x] `metadata` job handler — ISBN-then-title-author fallback, LLM paraphrase → `short_description`, enqueues follow-ups
- [x] `cover` job handler — OpenLibrary Covers HEAD-check (rejects placeholders) → Google Books thumbnail fallback
- [x] `embedding` job handler — `input_hash` skip, reuses recipe from `scripts/nebula/embed-books.ts`
- [x] `coords` job handler — region-local refinement using the `refine-coordinates.ts` mapping, scoped to one book
- [x] `app/api/enrichment/tick/route.ts` + `vercel.json` — cron-secret-guarded POST, schedule configured (dormant until deploy)
- [x] End-to-end verification: Dune metadata → embedding → coords pipeline succeeds in 3 worker passes
- [x] Commit B checkpoint

### Phase C — Top 10k seed (2026-04-24)

Added ~8,287 ISFDB-curated sff+horror shells on top of the existing Goodbooks-10k corpus (gap-fill only; existing books untouched). 8,287 metadata enrichment jobs enqueued for the worker.

- [x] Download latest ISFDB MySQL backup (manual via browser; `01-download.ts --file <path>` staged it)
- [x] Restore into local MariaDB 10.11 container (~10 min; 269,435 NOVEL titles)
- [x] Implement the seed selection pipeline per [`docs/nebula/seed-10k-selection.md`](./nebula/seed-10k-selection.md)
- [x] Export to `data/nebula/seed-top-10k.jsonl` (10,000 candidates after scoring + diversity quotas)
- [x] `scripts/nebula/seed-top-10k/04-load.ts` — idempotent loader; 8,287 new shells + 1,402 gap-fills on existing rows
- [x] Backfill `nb_editions` from ISFDB canonical pubs (9,502 rows)
- [x] Verify: 6/6 checks pass — 12,784 books, 9,504 with isfdb_id, genre mix 38/52/9, 19/20 canon fixtures
- [x] Commit C checkpoint

### Phase D — Sync user flows wired to the new pipeline (2026-04-24)

- [x] ISBN / barcode search: extended to `nb_editions` lookup + OpenLibrary + Google Books fallback via `resolveIsbnOrShell`; barcode scan on miss offers Add-to-Universe instead of dead-ending
- [x] Title search: pg_trgm-backed `searchBooksByTitle` server action falls back when in-memory returns < 3 hits; zero results surface an Add-to-Universe CTA
- [x] Upload flow (shelf add): emits `upload`/`wishlist`/`read` popularity signals via `nb_popularity_signals` on every shelf state change; `addToNebulaShelf` + `updateNebulaBookState` wired server-side
- [x] Book detail panel: subscribes to Supabase realtime on `nb_books` + `nb_enrichment_status`; "Enriching…" shimmer shows while `metadata_status` is shell/enriching/stale; patches in place when worker finishes
- [x] "Add to universe" CTA on search-miss + ISBN-miss: new `AddToUniverseDialog` presents top OpenLibrary/Google Books candidates; `createShellFromProvider` dedupes via `lib/nebula/dedupe.ts`, inserts shell + edition + enrichment_status + seeded coords, enqueues metadata job (priority 30, cascades to embedding + cover + coords)
- [x] Commit D checkpoint

Deferred to Phase E (not required for the core compounding UX):
- Unmatched-row handling in the CSV import flow (`NebulaUploadPanel`). Each unmatched row currently drops silently; would gain an inline "Add to universe" option per row.
- Author/series normalisation for user-entered books (currently best-effort lookup-by-name).

### Phase E — Attribution + quality

E.1 (legal-required) — committed 8be3c59:
- [x] Source-attribution footer (site-wide AttributionFooter + per-book Sources block driven by external_ids.provenance)
- [x] Description paraphrase pass (dedicated paraphrase job type; ~4,466 backfill jobs queued + processed)
- [x] UI prefers short_description; never displays raw description

E.2 (engagement + quality machinery) — committed in this phase:
- [x] coords handler: missing features now returns ok (benign-skip) instead of retry-cycling
- [x] Engagement-score rollup: nb_rollup_engagement RPC (00350), `/api/engagement/rollup` cron endpoint, `*/10 * * * *` schedule
- [x] LOD wiring in BookCloud: blended displayScore (0.8 popularity + 0.2 engagement) drives point size
- [x] Popular-path promotion: nightly cron + worker-startup pass enqueues due refreshes
- [x] Feature scoring backfill for Phase C shells via existing score-book-features.ts (Haiku 4.5)

E.3 (admin review queue) — committed in this phase:
- [x] Migration 00360: nb_review_queue table + nb_merge_works RPC (atomic merge of one work into another)
- [x] Three admin server actions (listReviewQueue, mergeReviewItem, dismissReviewItem) gated by lib/nebula/admin.ts requireAdmin()
- [x] /admin/review-queue page (tabs + side-by-side cards + merge/dismiss buttons)
- [x] scripts/nebula/audit-duplicates.ts — combined embedding + trigram scan; idempotent populate of the queue
- [x] Live-path hook in createShellFromProvider: gray-zone fuzzy matches now queue a review row instead of silently merging
- [x] ADMIN_USER_IDS env var allowlist

### Phase E.4 — Pre-deploy UI polish (committed `8659ef1`, `07f29fb`)

- [x] Series labels appear only when a book is clicked — single label on selection (`SeriesLabels`), always-on per-anchor labels removed (`SeriesAnchors`)
- [x] Region-fixed spacing slider in bottom-right (0.5×–5×, default 4.0×). Region anchors stay in place; only books expand outward from their region centroid. Single-source helper at `lib/nebula/world-scale.ts`.
- [x] Hardened `createAuthClient` to fall back to anon on Clerk JWT failure; switched read-only `getNebulaBookDetail` to service client.

### Phase E.5 — 2D / 3D toggle (committed `369870a` → `41a2fb6` plus E.5.6 closeout)

Top-of-view pill toggles between the existing R3F galaxy and an Obsidian-style force-directed 2D graph rendered with `react-force-graph-2d`. Both views subscribe to the same `NebulaContext`, so click / hover / search / Add-to-Universe / library highlighting work consistently across modes.

- [x] **E.5.1** `viewMode` state in context with `localStorage` persistence; `ViewModeToggle` pill at top-centre (`369870a`)
- [x] **E.5.2** Refactor: `NebulaView3D` extracted, `NebulaView2D` placeholder, orchestrator picks based on `viewMode`; 3D-only overlays (SpacingSlider, NebulaCompass) gated to `viewMode === '3d'` (`df2d5e2`)
- [x] **E.5.3** 2D core render — dynamic ForceGraph2D import, data adapter (books → nodes, series → links), seeded positions from `bookWorldPos × GRAPH_SCALE`, custom `nodeCanvasObject` painter with library-state colour overrides, hit-area paint, click → setSelectedBook, hover → setHoveredBook, title labels at zoom > 3 (`abe1f9a`)
- [x] **E.5.4** Custom d3-force `regionGravity` pulls books toward their region anchor (strength 0.05); region labels rendered in `onRenderFramePost` with fade by zoom level (`99ba4ea`)
- [x] **E.5.5** Search and deep-link parity — `flyTarget` signal watched in 2D, imperative `centerAt + zoom` on the ForceGraph2D ref over 700 ms, lands at zoom 4 so the target book's title fades in (`41a2fb6`)
- [x] **E.5.6** Mode swap fade-in transition (200 ms `animate-in`) so the toggle doesn't snap; roadmap closeout

Shared helper landed in this phase: `lib/nebula/book-display.ts` (`colorForBook` + `displayScore01`), single source of truth for node colour and size used by both renderers.

### Phase E.6 — Dynamic 2D interactions (committed `3b4a025` → `80e0269`)

Selection-aware overlays + draggable nodes turn the 2D mode from a settled snapshot into an interactive graph that responds to focus and to direct manipulation.

- [x] **E.6.0** Close out E.5.6 cleanly (`3b4a025`)
- [x] **E.6.1** Selected-series edge highlight: `linkColor` and `linkWidth` are now functions that brighten amber + thicken when both endpoints share `highlightedSeriesId` (`f0cce9d`)
- [x] **E.6.2** Similar-reads edges in 2D: thin cyan beams from the selected book to each `similarBookIds[i]`, drawn in `onRenderFramePost` (composed with region labels into a single `drawOverlays` callback) (`d7638ad`)
- [x] **E.6.3** Reading path in 2D: gold polyline (glow underlay + core stroke) through `sortedPath` when `showPath` is true; gaps where a step's node hasn't entered the graph yet split into separate subpaths so we don't draw straight lines across missing books (`73e9c1e`)
- [x] **Mid-phase bugfix** (`8de71f5`): paginated `fetchNebulaData` + `computeNebulaPath` so all 12,785 books reach the browser (was silently capped at 1,000 by PostgREST `max-rows`); 2D fly-to now uses live node position via `nodeById.get(selectedBookId)` instead of the seeded coord which had drifted under the d3 simulation. Surfaced by the user as "only 3 path datapoints" and "click Jaws → zoom to empty space."
- [x] **E.6.4** Draggable nodes with snap-back (`80e0269`): `enableNodeDrag={true}` + `onNodeDragEnd` clears `fx/fy` so the regionGravity force snaps the node home; connected series-mates ripple along during drag and snap-back via existing link springs. Region-gravity strength bumped 0.05 → 0.10 so the recovery feels elastic.
- [x] **E.6.5** Roadmap closeout (this commit)

Edge data for the new overlays does NOT enter `graphData.links` — they're paint-only inside `onRenderFramePost`, so selection changes don't disturb the simulation or re-seed positions.

### Phase E.7 — Region planets in 2D (committed `258afa6` → `cd19bc8`)

Brought the 3D galaxy's gravitational anchors into the 2D force-graph: 14 visible "region planets," each pinned at its anchor, draggable, with member books trailing along via `regionGravity` and snapping back on release. Closes the perception that the 2D layout had no clustering logic — clusters now have a visible centre and clicks fly the camera into a region.

- [x] **E.7.0** Doc closeout: flip pre-deploy item #1 (audit + queue resolution complete, 10 pairs reviewed 2026-04-29); defer remaining pre-deploy work; insert this section (`258afa6`)
- [x] **E.7.1** Region nodes added to `graphData` with `fx/fy` pinning at anchors via a discriminated union (`BookNode | RegionNode`); region ids namespaced `region:<id>`; click suppressed (no BookDetailPanel crash); hover ignored; `onNodeDragEnd` re-pins to anchor for snap-back (`759563d`)
- [x] **E.7.2** `regionGravity` rewritten to classify nodes at `initialize` time and target each region planet's **live** x/y per tick — when a planet drags, member books trail along; on release the planet returns to its anchor and books drift home (`286e4f3`)
- [x] **E.7.3** Polished planet visuals — halo + translucent disc + half-alpha rim, sized by `sqrt(memberCount)` clamped [20, 80] px; always-on uppercase label fading by zoom; `REGION_GRAVITY_STRENGTH` 0.10 → 0.20; redundant centroid label overlay removed. **Mid-block fix (E.7.3.1)**: introduced `pos2D()` helper using uniform `BASE × multiplier × GRAPH_SCALE` for both planets and books — earlier math left planets clumped in the inner ~25% of the auto-fit view; now planets distribute across the full canvas. 3D path untouched (still uses `bookWorldPos`). (`b25cd86`)
- [x] **E.7.4** Click-on-region routes to `flyToRegion` in 2D — destination read from `region2DAnchorMap` (not the 3D-world `flyTarget` which doesn't translate under uniform-scale); distinct `FLY_ZOOM_REGION` (1.2) and `FLY_ZOOM_HOME` (0.4) so cluster + overview reads land at the right scale (`cd19bc8`)
- [x] **E.7.5** Roadmap closeout (this commit)

Non-goals (held to): no theme-based clustering (regions only); no physical edges between planet and books (relationship implicit via the gravity force); no 3D version (3D already has `RegionPlanets.tsx`).

### Phase G — Tabs cleanup + reading-driven illumination + discovery polish (committed `4c22f5d` → `be87b7d`)

Reoriented the Nebula from "look at this whole catalog" to "watch your universe respond as you read." All ~12k books default to dim small dots; books on the user's shelf shine in their state colour (read=gold, reading=emerald, etc.); each shelf book illuminates ~6 nearby candidates as dark-purple dots with a silver fresnel rim. Empty shelf shows a quiet starfield + region planets + a one-time prompt to upload — uploads visibly reward (monetisation hook).

The discovery bundle made the experience read as adventure, not data: ignition animations, region awakenings, a personal north star, a recent-reading comet trail, fog-of-exploration dimming, and hover-trace arcs that highlight illumination connections.

Both 2D and 3D modes carry the same rules. The phase ran across many sub-commits as the visual model was tuned through user feedback (G.4.1 → G.4.7 each polished the 3D rendering; G.6.1–G.6.3 split the discovery bundle).

- [x] **G.0** Doc capture — Phase G plan + CLAUDE.md design-language additions (`4c22f5d`)
- [x] **G.1** Tab cleanup — drop Universe + World tabs, rename Sci-Fi → Nebula; root redirect; legacy redirects for /universe + /world; deleted ~3,500 lines of orphaned Universe-era code (`4948091`)
- [x] **G.2** Context illumination — `lib/nebula/illumination.ts` (`computeIllumination`); per-shelf-book edge cache for `nb_book_edges` mirroring `semanticCache`; spatial fallback for sources with no edges; `illuminationMap`, `illuminatedBookIds`, `regionShelfCounts` exposed on context (`2aa37e5`)
- [x] **G.3** Display helpers extended — `BookPaintTier`, `paintIntensity`, `regionPlanetIntensity` in `lib/nebula/book-display.ts` (shipped together with G.4 in `cf9e186`)
- [x] **G.4** 3D BookCloud + EmptyShelfPrompt — `paintIntensity` wired into `BookCloud.tsx`; `components/nebula/EmptyShelfPrompt.tsx` with single-shot 600 ms fade-out on first add (`cf9e186`)
- [x] **G.4.1** Per-instance alpha shader fix — `instanceAlpha` BufferAttribute on both core + glow geometries; fresnel + glow shaders multiply final colour by `vInstanceAlpha`. Fixes the "bake alpha into RGB" approach that was being undone by the fresnel rim boost + additive halo accumulation (`1a12425`)
- [x] **G.4.2** Rebalance tier constants + tier-aware halo size — SHELF_SIZE_FACTOR 1.0 → 2.0; ILLUMINATED_SIZE_FACTOR 1.2 → 1.5; BACKGROUND_DIM_ALPHA 0.30 → 0.15; HALO_MUL_BACKGROUND 1.6 (`a4912e3`)
- [x] **G.4.3** Recalibrate illuminated tier + squared halo alpha — ILLUMINATED_SIZE_FACTOR 1.5 → 0.7; ILLUMINATED_ALPHA 0.85 → 0.5; glow shader `colour × α² × 0.06` to disproportionately suppress dim halos under additive blending (`2ee99a9`)
- [x] **G.4.4** Dark-purple uniform for illuminated tier — ILLUMINATED_COLOR #9CA3AF → #4A3568 to escape region-tint via additive planet-halo blending; ILLUMINATED_ALPHA 0.5 → 0.7 to compensate for the darker base (`4d4c01a`)
- [x] **G.4.5** Removed SeriesAnchors — Phase D leftover that rendered ~100–200 region-coloured emissive spheres at series centroids; incompatible with Phase G's shelf-driven colour model (`a02cf1e`)
- [x] **G.4.6** Illuminated to shelf size + IlluminationEdges replaces SeriesEdges — ILLUMINATED_SIZE_FACTOR 0.7 → 2.0; new `IlluminationEdges` draws faint white lines only from each shelf book to its ~6 illuminated neighbours (~150 segments instead of ~3,000+) (`520c939`)
- [x] **G.4.7** Silver rim on illuminated books — second per-instance attribute `instanceRimColor` (3-component) attached to core mesh; fresnel rim reads from rim colour while core stays at the base colour, giving a dark centre with a crisp silver outline against any backdrop (`7574ecb`)
- [x] **G.5** 2D paintNode applies illumination — `NebulaView2D.tsx::paintNode` uses `paintIntensity`; `globalAlpha` gates fills; background books skip the outer-glow ring to avoid noise at close zoom (`20935df`)
- [x] **G.6.1** D4 region planet brightness scales with shelf count — `regionPlanetIntensity` in `lib/nebula/book-display.ts` consumed by `RegionPlanets.tsx` (3D) and the 2D region paint branch; halo + atmosphere + core opacity scale with sqrt(shelfCount/30) (`40fc902`)
- [x] **G.6.2** D2 region awakening flash — context detects 0→N transitions in `regionShelfCounts`; planet flashes ~1 s with `(1 - t) * sin(π·t)` curve on radius + halo opacity (`8f90147`)
- [x] **G.6.3** D1 ignition pulse + cascade — source book pulses 1.5× scale ease-out over 600 ms; newly-illuminated neighbours fade in with deterministic 0–300 ms stagger between 300–1300 ms; tracked via `ignitedBook` + `newlyIlluminatedRef` on context (`ff5851c`)
- [x] **G.7** D3 personal north star — TasteMarker → NorthStar; `shelfCentroid` derived value (unweighted, all shelf, min 1); 800 ms exponential ease on position change; gold pulsing core + halo. 2D paints the same in `drawOverlays` (`7049a29`)
- [x] **G.8** D6 reading-trail comet — `nb_user_books.created_at` migration (`00370`); `addedAt` on `UserBookState`; `recentShelfBooks` (top 3 by addedAt). 3D `ReadingTrail` with 2-segment fading polyline + 40-particle THREE.Points wake from head book for 5 s after add. 2D canvas equivalent (`f512665`)
- [x] **G.8.1** Burst on every shelf action — drop the `wasOnShelf` gate in `addToShelf`; fire `setIgnitedBook` from `updateBookState` too. Status flips and ownership changes now also burst from the touched book (`7164d58`)
- [x] **G.9** D7 fog of exploration — `fogLevel: Map<bookId, number>` derived value (squared distance to nearest shelf/illuminated, observed-max normalised); FOG_DIM_RANGE = 0.7 modulates background tier alpha to 30% at the periphery; ~30 ms compute per shelf change (`553a172`)
- [x] **G.10** D8 hover-trace — `IlluminationEdges` splits into base (faint white 0.06 after G.10.1) + highlight (bright white 0.6, edges touching `hoveredBookId`); 2D `drawHoverTrace` paints arcs on demand (no persistent illumination-edge layer in 2D). Symmetric: hover shelf book brightens its 6 outgoing lines; hover illuminated book brightens line(s) to source(s) (`bfc0990`)
- [x] **G.10.1** Halve base illumination-edge opacity — 0.12 → 0.06 in 3D so the always-on lines are quieter and hover-trace pops more (`be87b7d`)
- [x] **G.11** Phase G closeout — this commit. Flipped checkboxes, added commit refs, added the visual-language reference below.

**Paused / deferred**: D5 bridge stars (two-tone colour conflicts with shelf-driven colour override; rethink later).

### Visual language (locked-in conventions for future sessions)

The Nebula's visual model is shelf-driven. These rules are now load-bearing — future features should compose on top of them, not against them.

**Layers (3D paint order, bottom to top)**:
1. Region planet halos / atmospheres / cores — region-coloured, additive blending. Brightness scales with shelf-count via `regionPlanetIntensity`.
2. Background-tier books — dim indigo (CLOUD_COLOR), small (sizeFactor 0.4), alpha 0.15 modulated by `fogLevel`. The starfield.
3. Illuminated-tier books — dark purple core + silver rim via second instance attribute, sizeFactor 2.0, alpha 0.7. Recommendations from your shelf.
4. Shelf-tier books — state colour (gold/emerald/amber/cyan/purple), sizeFactor 2.0, alpha 1.0. Yours.
5. IlluminationEdges — faint white at 0.06 opacity for ambient lines; 0.6 for hover-highlight.
6. ReadingTrail polyline — gold, alpha 0.85 → 0.2 from head to tail, 0–2 segments through `recentShelfBooks`.
7. NorthStar — gold pulsing billboard at the shelf centroid.
8. Particle wake — gold THREE.Points spawning from the most-recently-touched book on every shelf action; 5 s lifetime, additive blending.

**Colours**:
- Region: `nb_regions.color_hex` — used only by region planets and (until G.4.5 deletion) the deprecated SeriesAnchors. Books are NEVER region-coloured.
- State: gold #FFD700 (read), emerald #34D399 (reading), amber #F59E0B (next_up), cyan #38BDF8 (on_shelf), purple #C084FC (wishlist).
- Background: indigo CLOUD_COLOR #6366F1.
- Illuminated core: dark purple ILLUMINATED_COLOR #4A3568.
- Illuminated rim: silver ILLUMINATED_RIM_COLOR #C0C0C0.
- Selection / pulse: white #FFFFFF.
- Series-sibling highlight: amber SERIES_SIBLING_COLOR #F59E0B.

**Animation timings**:
- D1 source pulse: 600 ms, ease-out `(1 - t) * sin(π·t)`, peak scale 1.5×.
- D1 cascade: 300 ms fade-in per neighbour, 0–300 ms deterministic stagger from bookId hash.
- D2 region awakening: 1 s, same `(1 - t) * sin(π·t)` curve, peak radius 1.2×, peak halo 3× opacity.
- D6 particle wake: 5 s lifetime, age-driven size growth + alpha decay, 40 particles per spawn.
- D7 fog: instant (no animation, recomputes on shelf change).
- D8 hover: instant on/off (hover affordance).
- North-star ease: ~800 ms exponential decay (`α = 1 - exp(-dt / 0.8)`).
- Ignition replaces the most-recent — single-slot, rapid sequential adds reset the timer.

**Burst trigger surface (G.8.1)**:
Any positive shelf action fires `setIgnitedBook({ bookId, at: Date.now() })`:
- `addToShelf` (new add, re-add, status flip via this entrypoint)
- `updateBookState` (status / ownership change on existing shelf book)
- `removeFromShelf` does NOT fire — removal is a negative action.

**Don't break**:
- Region colour belongs only on planets. Putting it on books violates the shelf-driven model.
- Universal-grey was rejected for illuminated tier (region tint via additive halos pulled them off-grey). Dark purple is the answer. Don't revisit unless the planet halos themselves change.
- Series spine edges across the whole catalog are out (G.4.5/G.4.6 removed both SeriesAnchors and SeriesEdges from 3D). 2D's force-graph link layer still uses series for the d3 simulation but renders them subtly.

### Pre-deploy checklist (DEFERRED)

Deferred per direction 2026-04-29 — pre-launch features land first (next phase, TBD), then this runs in order. Pre-deploy item A0 is already done. Updated 2026-05-04 with the detailed A–E breakdown.

**A — Known issues to resolve**

| ID | Item | Where | Effort | Severity |
|---|---|---|---|---|
| A0 | Run `audit-duplicates.ts`; resolve queue at `/admin/review-queue` | scripts/nebula/audit-duplicates.ts | done 2026-04-29 | — |
| A1 | Hydration mismatch on `/admin/review-queue` | `app/admin/review-queue/page.tsx` (likely a `Date` or random-id render path differing server vs client) | ~30 min | Low — console error every visit; nice to fix before launch |

**B — Infrastructure / env vars**

`.env.local` has 13 vars; deployment expects **14**.

| ID | Var | Status | Notes |
|---|---|---|---|
| B1 | `CRON_SECRET` | [ ] missing locally | Required by all 3 cron routes (`app/api/enrichment/tick/route.ts:16`, `app/api/engagement/rollup/route.ts`, `app/api/engagement/promote-popular/route.ts`). Generate once, set in Vercel + locally. |
| B2 | Clerk × 6, Supabase × 3, OpenAI, Anthropic, Google Books, ADMIN_USER_IDS | [ ] not in Vercel | Push to Production + Preview scopes via dashboard "Import .env" |

Effort: ~5 min for the full set.

**C — Vercel deploy + cron verification**

| ID | Item | Effort |
|---|---|---|
| C1 | `vercel link` against the project | ~2 min |
| C2 | `vercel env pull` round-trip sanity check | ~1 min |
| C3 | `vercel deploy --prod` | ~5 min build |
| C4 | `vercel crons ls` — verify three crons fire: `* * * * *` (enrichment tick), `*/10 * * * *` (engagement rollup), `0 3 * * *` (promote-popular) | ~5 min |
| C5 | Watch first cron fires in Vercel Dashboard → Functions → Cron Jobs; confirm `nb_enrichment_jobs.status='running'` rows process | ~30 min passive |

**D — Production smoke test**

| ID | Item | Why |
|---|---|---|
| D1 | Search a known-good book → click → BookDetailPanel opens with paraphrased description | Supabase RLS + Clerk JWT + realtime subscription |
| D2 | ISBN/barcode scan a real book | Edition lookup → external provider → shell creation chain |
| D3 | Add-to-Universe an unknown title | Zero-result CTA → dialog → embedding+trigram dedupe → fade-in to galaxy |
| D4 | Visit `/admin/review-queue` as the `ADMIN_USER_IDS` user | Admin gate |
| D5 | Toggle 2D mode, drag a region planet, click a planet to fly | Phase E.7 ships clean in prod |
| D6 | Watch enrichment backlog drain over 24 hrs (~12k jobs at cron pace) | Confirms write-back path |

**E — Operational monitoring** (per `CLAUDE.md:34-46` declared stack, not yet wired)

| ID | Item | Effort | Notes |
|---|---|---|---|
| E1 | Sentry (server + client) — error tracking | ~30 min | `@sentry/nextjs`, set `SENTRY_DSN`, upload sourcemaps in build |
| E2 | Uptime Robot monitor on production URL + `/api/enrichment/tick` health | ~15 min | Free tier sufficient |
| E3 | Cloudflare DNS → custom domain (optional for v1) | ~30 min including propagation | `*.vercel.app` works as default |

**Totals**: ~3 hrs active before deploy (A1 + B + C + D + E1 + E2). E3 optional. Re-prioritise once the pre-launch feature batch lands.

### Phase F — Long play (post-deploy)

Order roughly by impact for solo-dev validation.

- [ ] **Wikidata author bios** (~1 day): server action queries Wikidata SPARQL by author name → birth/death years + bio paragraph; render in BookDetailPanel below Sources block. CC0, no attribution overhead.
- [ ] **Award display in book detail**: `nb_book_awards` is already populated by the seed. Render a small awards row (Hugo, Nebula, Locus, Bram Stoker icons) when present.
- [ ] **Series explorer**: clicking a series label lists all members in a side panel with reading-order numbering.
- [ ] **In-app user ratings + reviews**: replace `popularity_score` as the authoritative quality signal once we have real users.
- [ ] **Amazon PA-API pricing** (~3–5 days + affiliate approval lead time): plug into `nb_pricing_snapshots`. Requires 3 qualifying sales within 180 days of approval to keep the affiliate account alive.
- [ ] **6-monthly ISFDB refresh automation**: GitHub Action runs the seed pipeline in delta mode, writes to `nb_external_source_runs`, emails diff summary via Resend.
- [ ] **SFFRD criticism integration** (deferred from v1): polite TAMU crawler + new `nb_criticism_sources` table.
- [ ] **Per-user Clerk admin roles**: replace the env-var allowlist when there's a second admin.
- [ ] **Audit-duplicates as a weekly cron**: re-run `audit-duplicates.ts` after every major ingest.
- [ ] **Auto-merge classifier**: train a small model from confirmed merge/dismiss decisions in `nb_review_queue` so high-confidence merges happen automatically.
- [ ] **Mobile UI polish**: the 3D galaxy is currently desktop-first. Touch controls, smaller viewport tuning.
- [ ] **Performance @ 50k+ books**: profile BookCloud rendering, consider LOD-based culling at galaxy zoom.

---

## Non-goals / deferred

- **Full 300k ISFDB bulk ingest** — rejected in favour of top-10k seed + lazy enrichment. Replaced the earlier "ISFDB-exhaustive" plan.
- **SFFRD in v1** — criticism data is a Phase F bonus, not a launch requirement.
- **Pinecone / external vector DB** — pgvector is sufficient through Phase F.
- **Pricing in MVP** — volatile, requires Amazon approval, not worth the complexity until the galaxy works well.

---

## Where the data comes from (one-line summary)

| Field family | Primary | Fallback | When fetched |
|---|---|---|---|
| Title / author / year / series | ISFDB (local dump) | OpenLibrary → Google Books | Async on first enrichment |
| Description | ISFDB → LLM paraphrase | OpenLibrary → LLM paraphrase | Async |
| Cover | OpenLibrary Covers by ISBN | Google Books thumbnail | Sync on first ISBN hit |
| Edition / ISBN / pages | ISFDB `pubs` | OpenLibrary editions | Sync on ISBN/upload; async for back-enrichment |
| Tags / awards | ISFDB | Wikidata | Async |
| Author bio | Wikidata | OpenLibrary | Async on author click |
| Popularity (seed) | goodbooks-10k + ISFDB awards | — | One-time at seed |
| Engagement (live) | In-app signals | — | Continuous |
| Rating | In-app users | OpenLibrary | Continuous / Async |
| Pricing | Amazon PA-API (Phase F) | — | On-demand |
| Embeddings | OpenAI text-embedding-3-small | — | Async on input-hash change |
| Feature scores (10-axis) | LLM over description + tags | — | Async after metadata enrichment |

Full details, merge rules, and behaviour per user action: [`docs/nebula/compounding-catalog.md`](./nebula/compounding-catalog.md).

---

## How to work this roadmap

- **When starting a session**: read this file and `docs/nebula/compounding-catalog.md` first.
- **When finishing a task**: flip its checkbox here in the same commit as the code change.
- **When scope shifts**: add a line under "Non-goals" explaining what and why, don't silently delete items.
- **Commit checkpoints** are marked in the phase lists — use them as natural pause points.
- **Update the "Catalog snapshot" + "Last updated" + "(CURRENT)" markers** when phase boundaries move so the top of the file always reflects reality.
- **Phase closeout is non-negotiable** (see CLAUDE.md): a phase is only done when typecheck is clean, the roadmap reflects reality, and a commit captures both. No "next step" while the working tree is dirty.
