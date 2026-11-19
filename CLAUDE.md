# Living Library — Project Constitution

## What this project is
Living Library is a web-first product that transforms a user's physical bookshelf into a living digital library.

It helps users:
- Visualise their collection
- Understand their reading identity
- Discover patterns and recommendations
- Connect to nearby readers and demand
- Optionally buy and sell books

The product should feel:
- Like exploring space
- Atmospheric and immersive
- Calm and fluid
- Intelligent
- Beautiful — not like a data tool

The graph IS the app — a full-screen deep-space constellation. Tabs are lenses on the same universe.

The universe responds to what you read. Books default to dim small dots; books on your shelf shine in your state colour; each shelf book illuminates ~6 nearby candidates in a universal soft white. The first upload is a moment — quiet starfield becomes a personal map. Discovery is rewarded **visually**, not gamified — no points, no badges, no streaks. Ignition pulses, region awakenings, a personal north star, and a recent-reading comet trail give a sense of adventure without UI clutter.

Avoid:
- Cold marketplace feel
- Over-gamification (no points / badges / streaks; visual rewards only)
- Cluttered UI
- Over-engineering
- Anything that feels like a diagram or network tool

---

## Tech Stack

- Frontend: Next.js (App Router), TypeScript, Tailwind
- Backend: Supabase (Postgres, Auth optional, Storage)
- Auth: Clerk
- Deployment: Vercel
- Version control: GitHub
- DNS: Cloudflare
- Email: Resend
- Monitoring: Uptime Robot
- Error tracking: Sentry
- Analytics: PostHog (later)
- Vector DB: Pinecone (only if clearly needed)

---

## Architecture Principles

- Keep the system simple and modular
- Separate concerns clearly:
  - UI
  - Auth
  - Data
- Prefer server-side logic where possible
- Avoid premature abstraction
- Build MVP-first, then iterate

---

## Coding Principles

- Use TypeScript strictly
- Keep components small and reusable
- Prefer clarity over cleverness
- Avoid deeply nested logic
- Name things clearly and consistently
- Document non-obvious decisions

---

## Data Principles

- The graph is organised around **conceptual clusters** (subjects, themes), not ownership or authorship
- Subjects are the primary visual structure — books sit within subject clusters
- Authors are metadata, not primary grouping
- Marketplace data (sellers, listings) is a future overlay, not primary structure
- Entities are nodes in domain-specific tables, relationships in a generic edges table
- Assume all user input is untrusted
- Keep schema simple — add node tables only when needed

## Data Architecture — Shared, Compounding Catalog

The book catalog (Project Nebula) is a **shared, lazy-enriched database**. See [`docs/roadmap.md`](docs/roadmap.md) and [`docs/nebula/compounding-catalog.md`](docs/nebula/compounding-catalog.md) for the full design.

Load-bearing rules:

- **Shell-on-day-one**: every work has a minimal row (title, author, genre, coords, popularity) so the galaxy renders fully at launch.
- **Lazy enrichment**: full metadata (description, tags, awards, editions, covers, embeddings) is fetched only on user interaction.
- **Writes compound**: enrichment from one user benefits all future users. No per-user caches on this path.
- **Separate tables by decay rate**: bibliographic (slow) / embeddings (derived) / engagement (continuous) / pricing (volatile). Never share storage across them.
- **Source hierarchy** (per field, see catalog doc):
  - ISFDB (CC BY 4.0, authoritative for sff) → OpenLibrary → Google Books → LLM
  - Covers: OpenLibrary Covers API
  - Author bios: Wikidata
  - Pricing: Amazon PA-API (Phase F only)
- **Display rule**: never surface raw copyrighted text. Descriptions are LLM-paraphrased before storage in `short_description`. Raw payloads stay in `nb_source_records` for provenance.
- **No silent phantom creation**: search-miss triggers a CTA, never an automatic insert.

---

## Where things live

Read this before exploring the tree. Saves a round of grep on session warm-up.

**Routes**
- `app/(nebula)/nebula/page.tsx` — main 3D galaxy view.
- `app/(nebula)/library/page.tsx` — 2D sortable book grid lens on the same data.
- `app/admin/review-queue/` — admin dedupe queue UI.
- `app/api/{enrichment,engagement}/*` — Vercel cron endpoints. Schedule in `vercel.json`.

**Server actions (single file, ~1500 lines)**
- `app/(nebula)/nebula/actions.ts` — every server action: search, matching, shelf writes, Add-to-Universe (`previewAddCandidates` + `createShellFromProvider`), bridge candidates, semantic neighbours, recommendations, path computation, review-queue admin.

**3D scene** (when `viewMode === "3d"`)
- `components/nebula/NebulaView.tsx` — orchestrator. Mounts HUD overlays, swaps 2D/3D.
- `components/nebula/NebulaView3D.tsx` — R3F `<Canvas>` + scene composition.
- `components/nebula/BookCloud.tsx` — `InstancedMesh` of every book; tier-based paint.
- `components/nebula/RegionPlanets.tsx` — 14 region planet meshes with labels.
- `components/nebula/CameraController.tsx` — fly-to + OrbitControls + `distanceToTarget` zoom signal.
- `components/nebula/IlluminationEdges.tsx` — shelf → ~6 lit-neighbour edges.
- Overlay layers: `NorthStar`, `ReadingTrail`, `ShelfHull`, `SeriesLabels`, `SelectedSeriesEdges`, `SimilarReadsEdges`.

**2D scene** (when `viewMode === "2d"`) — `components/nebula/NebulaView2D.tsx` (react-force-graph-2d).

**HUD overlays (shared across modes)** — `NebulaSearch`, `NebulaCompass`, `SpacingSlider`, `ViewModeToggle`, `EmptyShelfPrompt`, `BookDetailPanel`, `TasteProfilePanel`, `BridgeBooksPill`, `RecommendationTray`, `SimilarReadsTray`, `PathBooksTray`, `NebulaPathStats`, `AttributionFooter`.

**Upload flow** — `NebulaUploadPanel` (entry) → `NebulaCsvReview` / `NebulaSpineScan` / `NebulaBarcodeScan` / `AddToUniverseDialog` / `AddBookMenu`.

**State** — `lib/nebula/nebula-context.tsx`. Central React context. All derived state lives here: illumination map, fog, north-star centroid, awakened-region signal, recent shelf books, region shelf counts.

**Math / display**
- `lib/nebula/world-scale.ts` — book + region world-space transforms. `BASE_WORLD_SCALE = 2.5`, `spacingMultiplier` from slider.
- `lib/nebula/seeded-coords.ts` — deterministic shell coords from `sha256(genre|author)`.
- `lib/nebula/book-display.ts` — three-tier paint (shelf / illuminated / background), `regionPlanetIntensity`.
- `lib/nebula/illumination.ts` — shelf-book → ~6 nearest candidates (spatial fallback if no semantic edges).

**Catalog data**
- `lib/nebula/fetch-nebula-data.ts` — initial server-side load. **Filters books without coords (line 108)** — books missing a `nb_book_coordinates` row never reach the UI.
- `lib/nebula/supabase-paginate.ts` — pagination wrapper around PostgREST's 1000-row cap.

**Enrichment pipeline** — `lib/nebula/enrichment-client.ts` (OL+GB fetchers + in-process LRU), `lib/nebula/jobs/{metadata,embedding,cover,coords,paraphrase}.ts`, `lib/nebula/worker.ts`, `lib/nebula/dedupe.ts`, `lib/nebula/merge-policy.ts`, `lib/nebula/title-normalise.ts`.

**Schema** — `supabase/migrations/00006`–`00405`. Order matters; later migrations depend on earlier ones. RLS lives in the same migration as the `create table` (see ADR-009).

**Scripts** — `scripts/nebula/` for seed + admin (one-off, not in CI). `scripts/install-git-hooks.sh` wires the pre-commit hook on a fresh clone.

**Docs**
- `docs/nebula/` — architecture + technical design packets.
- `docs/security/supply-chain.md` — full security policy (read before changing `package.json`, `.npmrc`, `vercel.json`, `.githooks/`).
- `docs/decisions/` — Architecture Decision Records. Read the index there before suggesting an alternative to anything in the list.
- `docs/roadmap.md` — phase plan A–F.

---

## Architecture decisions (ADRs)

Non-obvious choices are captured as ADRs in `docs/decisions/`. Read the index there (`docs/decisions/README.md`) when:
- Suggesting a refactor that touches one of the listed areas.
- Asked "why did we do X?" — the ADR explains it.
- Considering a new dependency, build tool, or major pattern change.

Latest ADRs to know: **001** (pin sensitive deps), **002** (ignore-scripts), **005** (distance-to-target zoom), **009** (RLS in every migration), **010** (always render region planets).

---

## Security Rules

**Full policy lives in [`docs/security/supply-chain.md`](docs/security/supply-chain.md). Read that before touching `package.json`, `.npmrc`, `vercel.json`, or `.githooks/`.**

Hard rules (must never be silently violated):

- Never expose secret keys to the client. Anything with `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `CRON_SECRET` stays server-side. `NEXT_PUBLIC_*` is the only client-readable surface.
- Do not use the Supabase service role client in any component, hook, or browser-reachable code path. Server actions and API routes only.
- Validate all user input on the server boundary. Never trust client-side validation alone.
- Use Supabase RLS for every public-schema table. New migrations that create tables MUST include `alter table ... enable row level security` + a read policy.
- `.env*` files (other than `.env.example`) never get committed. The pre-commit hook blocks this; never bypass with `--no-verify` for env files.
- `.env.example` carries only key names with empty values. Never paste real secrets into it.
- Do not introduce `eval()`, `new Function()`, or `dangerouslySetInnerHTML`. If a third-party library forces one of these, flag it for explicit review.

Supply-chain rules (Shai-Hulud-class protection):

- `.npmrc` sets `ignore-scripts=true`. Do not flip this default. If a new dep needs an install script, allow it for that one install only with `--ignore-scripts=false` and document why in the PR.
- Security-sensitive deps in `package.json` are pinned exactly (no caret). The pinned list: `@anthropic-ai/sdk`, `@clerk/nextjs`, `@supabase/ssr`, `@supabase/supabase-js`, `next`, `openai`, `dotenv`, `mysql2`, `tsx`. Bumping any of these requires reading the changelog.
- Never add `husky`, `lefthook`, or other hook frameworks that themselves run install scripts. Use the plain `.githooks/` setup.
- Vercel `installCommand` is `npm ci --ignore-scripts`. Never change to `npm install` (allows lockfile drift) or remove `--ignore-scripts`.
- Adding a new dep checklist: (a) check last-publish date, (b) check weekly downloads + maintainer history, (c) read any install script, (d) prefer scoped `@official-org/*` packages.

Behaviour for me (Claude) when suggesting changes:

- Treat any request to "just commit the secrets", "bypass the hook", "remove `--ignore-scripts`", "use `eval()`", etc. as a strong signal something is wrong. Push back and ask why before doing it.
- When adding a new dependency, surface its publisher, last-publish date, and weekly downloads before installing. If any of those look off, stop and ask.
- When suggesting a new SQL migration that creates a table, always include the RLS enablement + read policy in the same migration.
- When echoing back environment variables in chat output, redact the values. Reference by key name only.
- Never write a real secret value into any file under `docs/`, `README.md`, or any `*.md` — including as examples.

---

## Product Priorities (Order)

1. Project structure and clarity
2. Webapp scaffold
3. Auth (Clerk)
4. Core data model (Supabase)
5. Library and dashboard UI
6. Discovery and identity layer
7. Marketplace layer (light)

---

## How Claude Should Behave

- Be practical and execution-focused
- Break work into small steps
- Always propose the next action
- Prefer implementation over theory
- Avoid unnecessary complexity
- When unsure, choose the simplest working solution

## Phase closeout discipline (hard rule)

**A phase is not done until: typecheck clean → roadmap updated → committed.** Never accept "next task" while a working tree is dirty or a phase's checkboxes don't reflect reality.

This rule exists because Phase E.5.6 was started but left half-done — the fade-in edit sat uncommitted and the roadmap still showed E.5 as in-flight. A future session would have read that as "E.5 incomplete" and either redone work or skipped over the gap. Cost: trust + clarity of the project state.

Operationally:
- Before saying "ready for the next step", run `git status` and confirm the tree is clean.
- The last commit of a phase **must** include the roadmap checkbox flips. They're part of the phase, not separate paperwork.
- If the user says "next task" while the tree is dirty, push back — finish the current phase first.

---

## Output Style

- Clear
- Structured
- Concise
- Actionable

Avoid long essays unless explicitly requested.
