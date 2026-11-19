# Project Nebula — Architecture

## What is Nebula?

Nebula is a separate 3D semantic library focused on sci-fi and fantasy. It lives within the Living Library codebase but is fully isolated — separate tables, components, state, and rendering.

## Naming convention

- **Universe** = the existing Living Library 2D constellation (subjects, reading path, etc.)
- **Nebula** = the new sci-fi/fantasy 3D semantic world
- All Nebula database tables are prefixed `nb_`
- All Nebula components are in `components/nebula/`
- All Nebula lib code is in `lib/nebula/`
- All Nebula routes are under `app/(nebula)/nebula/`

## Isolation rules

Nebula MUST NOT:
- Import from `lib/universe-context.tsx`
- Import from `lib/fetch-universe-data.ts`
- Modify `components/UniverseView.tsx`
- Use the existing `books`, `edges`, `subjects`, `themes`, or `authors` tables
- Share React context with the Universe

Nebula MAY:
- Import from `lib/open-library.ts` (shared utility)
- Use the same Clerk auth
- Use the same Supabase instance (different tables)
- Share the `(tabs)/layout.tsx` shell and `BottomNav`

## Tech stack differences

| Aspect | Universe | Nebula |
|--------|----------|--------|
| Rendering | react-force-graph-2d (2D canvas) | React Three Fiber (3D WebGL) |
| Graph | D3 force simulation | Pre-computed 3D coordinates |
| Data model | Generic edges table | Typed tables (book_edges, book_features, etc.) |
| Corpus | User's personal library (~200 books) | Curated universe (5,000 sci-fi/fantasy books) |
| Embeddings | None | pgvector (1536-dim) |
| Clustering | Subject-based (15 categories) | Semantic (hierarchical: region → cluster → micro) |

## Database tables (nb_ prefix)

See migration `00100_create_nebula_tables.sql` for full schema.

Core: `nb_authors`, `nb_series`, `nb_books`, `nb_book_authors`, `nb_book_tags`, `nb_book_features`, `nb_book_embeddings`

Spatial: `nb_regions`, `nb_clusters`, `nb_book_cluster_membership`, `nb_book_coordinates`, `nb_book_edges`, `nb_book_graph_metrics`

User: `nb_user_books`, `nb_user_shelf_uploads`, `nb_user_upload_candidates`, `nb_user_taste_profiles`, `nb_user_taste_clusters`, `nb_user_paths`, `nb_recommendation_cache`

## Architecture direction (updated 2026-04-21)

Nebula has shifted to a **shared, compounding catalog** model. Day-one shells + lazy enrichment + central write-back. See:
- [`docs/roadmap.md`](../roadmap.md) — phased plan and checkboxes
- [`docs/nebula/compounding-catalog.md`](./compounding-catalog.md) — full data-source map, behaviour rules, merge policy
- [`docs/nebula/seed-10k-selection.md`](./seed-10k-selection.md) — how the top 10k sff+horror seed is selected

The prior ISFDB-exhaustive import plan (`~/.claude/plans/okay-before-we-move-wondrous-frost.md`) is superseded; ISFDB is now used as a seed source + on-demand provider, not a bulk target.

## Current state (Block 7 complete — MVP done)

- 4,497 sci-fi/fantasy books seeded from Goodbooks-10k (will be replaced by the top-10k seed in Phase C)
- 1,450 authors, 1,076 series, 14 regions with 3D anchors
- 3D scene: instanced rendering, orbit controls, deep space background
- Search: client-side filter, camera fly-to, gold highlight on selected
- Region labels: clickable, camera flies to region
- Book detail: side panel with cover, description, series, popularity (on-demand fetch)
- User shelf: search-to-add + CSV import with fuzzy matching + confidence scoring
- My Shelf toggle: owned books highlighted emerald green, unowned dimmed
- Canonical matching engine: ISBN exact + fuzzy title/author against nb_books corpus
- User path: chronology mode + spatial nearest-neighbor fallback, golden 3D tube (CatmullRomCurve3)
- Recommendations: top 10 by proximity to shelf centroid + genre match, bottom tray with fly-to
- Region clouds: translucent spheres at region anchors, sized by book count
- Series clustering: books in same series repositioned to cluster tightly (radius 0.03)
- Series labels: floating names at series centroids (3+ books), distance-faded
- Series edges: thin line segments connecting consecutive series books
- Dev: proxy.ts (renamed from middleware.ts for Next.js 16), Turbopack persistent cache disabled

## Revert point

Tag `v2-stable` marks the last commit before any Nebula work. To revert: `git reset --hard v2-stable`.

## Reference documents

- `docs/nebula/seed-dataset-research.md` — 5,000-book seed dataset strategy
- `docs/nebula/technical-design-packet.md` — full technical design (8 documents)
