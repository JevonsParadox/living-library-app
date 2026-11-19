# Living Library

A web app that turns a physical bookshelf into a navigable universe of ideas. Your books are stars, your subjects are nebulae, and the shape of your galaxy is your identity as a reader. The interface *is* the graph: tabs are lenses on one persistent universe, not separate pages.

It went through two versions:

- **v1, April 2026: Universe.** Your own library as a 2D constellation (react-force-graph-2d). Subjects orbit Fiction and Non-fiction "suns", bridge books link clusters, and a reading path traces how you've moved through ideas.
- **v2, May 2026: Nebula (the current app).** A curated 3D semantic map of ~12,800 science-fiction and fantasy books (React Three Fiber / WebGL). Similar books sit near each other in space, and the books on your shelf "illuminate" the unread books they point toward. v1 showed that a personal shelf of ~200 books is too sparse to be interesting on its own; Nebula places your shelf inside a much larger world.

## What's interesting under the hood

- **Shelf capture from a photo.** Photograph a shelf. A vision model reads the spines (`app/actions/scan-spine.ts`), the titles are fuzzy-matched against Open Library (`match-spines.ts`), and you confirm the matches before anything is added.
- **A semantic map built offline.** Books are embedded with `text-embedding-3-small` (pgvector, 1536-dim). Similarity edges, bridge scores and 3D coordinates are pre-computed by resumable scripts (`scripts/nebula/`), so the browser renders a stable world rather than running a live force simulation over 12,000 nodes.
- **Source-tier merge policy.** Book metadata arrives from several providers. `lib/nebula/merge-policy.ts` decides field-by-field which source wins: user edits > ISFDB > Open Library > Google Books > LLM. Lower tiers only fill gaps, and a user's edit is never overwritten.
- **Background enrichment queue.** A job table plus worker (`lib/nebula/worker.ts`), driven by a cron endpoint with a shared-secret check and a hard deadline per run. It fetches metadata, de-duplicates editions, and queues low-confidence matches for human review in an admin screen.
- **Recommendations by illumination.** For each shelf book, its nearest unread neighbours come from semantic edges, with a spatial-KNN fallback (`lib/nebula/illumination.ts`). They're aggregated into a many-to-many map, so the UI can show *which* of your books points to each suggestion.
- **Licence-aware data.** Seed sources (ISFDB CC BY 4.0, goodbooks-10k CC BY-SA 4.0) are used as signals and attributed; synopses are re-paraphrased before display. The derived seed datasets are not included in this repo; `scripts/nebula/` rebuilds them.

## Stack

TypeScript · Next.js (App Router, server actions) · React Three Fiber / three.js · react-force-graph-2d · Supabase Postgres with pgvector and row-level security · Clerk auth (Clerk JWT → Supabase RLS) · OpenAI embeddings · Anthropic Claude (vision, feature scoring) · Vercel cron

## Repo map

| Path | What |
|---|---|
| `app/(nebula)` | The 3D Nebula world and your library |
| `app/(tabs)` | Shared shell and profile |
| `app/actions` | Server actions: spine scanning, matching, book ingestion |
| `app/api` | Cron endpoints: enrichment tick, engagement roll-up, popularity promotion |
| `app/admin` | Human review queue for uncertain matches |
| `lib/nebula` | Merge policy, de-duplication, enrichment worker, illumination |
| `scripts/nebula` | Offline pipeline: seed, embed, edges, coordinates, scoring |
| `supabase/migrations` | 19 migrations, including RLS policies |
| `docs/` | Vision, PRD, architecture, schema, security and Nebula design notes |
| `.claude/` | The AI-agent setup used to build it: specialist agents and review commands |

## Running it

```bash
npm ci
cp .env.example .env.local     # Supabase, Clerk, OpenAI, Anthropic keys
supabase db push               # apply migrations to your own project
npx tsx scripts/seed-subjects.ts
npm run dev
```

Building the Nebula corpus is a separate offline job; see `docs/nebula/` and `scripts/nebula/`.

## Status

Built April–August 2026 over 80 commits; published here as a clean snapshot of the private repo.

- **Working:** the 3D Nebula with ~12,800 books, embeddings, similarity edges and computed coordinates; four ways to add books (search, shelf-photo spine scan, barcode, CSV/Goodreads import); the enrichment queue and review screen; recommendations; Clerk auth with database row-level security.
- **Not done:** it was never launched publicly, and buying/selling and connecting with nearby readers stayed on the roadmap (`docs/roadmap.md`). Paused in favour of other work.

Built with AI coding agents (see `.claude/` and `CLAUDE.md`) under human review.
