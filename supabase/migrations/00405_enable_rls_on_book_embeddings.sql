-- ============================================================
-- Security fix: enable RLS on nb_book_embeddings
-- ============================================================
-- Migration 00200_enable_pgvector_and_embeddings.sql created
-- nb_book_embeddings but never enabled row-level security. Supabase
-- reported this as a critical issue on 2026-05-11: the table was
-- readable AND writable via the project's anon key.
--
-- The data itself (768-dim vectors) isn't sensitive, but the write
-- exposure is — anyone with the project URL could overwrite embeddings
-- and silently break semantic neighbour computation across the app.
--
-- Mirrors the posture used by every other catalog table
-- (nb_books, nb_book_awards, nb_book_authors, nb_editions, ...):
--   * RLS enabled
--   * SELECT policy for authenticated users (catalog data is public)
--   * No INSERT / UPDATE / DELETE policy → writes only via service role,
--     which is how the enrichment worker already writes embeddings
--     (see lib/nebula/jobs/embedding.ts).
--
-- This migration is idempotent — re-running it does nothing because
-- "enable row level security" on an already-RLS-enabled table is a
-- no-op and policies are guarded with `if not exists`.

alter table nb_book_embeddings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'nb_book_embeddings'
      and policyname = 'nb_read_global'
  ) then
    create policy "nb_read_global" on nb_book_embeddings
      for select to authenticated using (true);
  end if;
end $$;
