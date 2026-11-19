# ADR-009: RLS enabled + read policy in the same migration as the table
Date: 2026-05-14
Status: Accepted

## Context
Migration `00200_enable_pgvector_and_embeddings.sql` created `nb_book_embeddings` but never enabled row-level security. Supabase flagged it as a critical issue on 2026-05-11 — the table was readable AND writable via the project's anon key. The data (768-dim vectors) wasn't sensitive in itself, but the write exposure meant anyone could overwrite embeddings and silently break semantic neighbour computation across every user.

## Decision
Every new migration that creates a public-schema table MUST include `alter table ... enable row level security` + at minimum a read policy in the same migration. `CLAUDE.md`'s Security Rules capture this. The fix migration `00405_enable_rls_on_book_embeddings.sql` is idempotent (uses `if not exists` on the policy) so re-applying is safe.

## Consequences
Migration files are slightly longer. RLS-by-default mistakes can't ship under this rule. When in doubt, copy the pattern from `00300_external_sources.sql` line 83-86 (`enable rls` + `create policy "nb_read_global" for select to authenticated using (true)`).
