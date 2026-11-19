-- Migration 00300: External source enrichment (ISFDB)
-- Adds external_ids to book/author/series tables, a run-tracking table,
-- and awards (ISFDB-derived). Criticism tables (SFFRD) deferred to a later migration.

-- ============================================================
-- 1. external_ids JSONB columns
-- ============================================================
-- Convention:
-- {"isfdb": {"title_id": 12345, "alt_author_ids": [...], "synopsis_source": "isfdb:title:99"}}

alter table nb_books    add column external_ids jsonb not null default '{}'::jsonb;
alter table nb_authors  add column external_ids jsonb not null default '{}'::jsonb;
alter table nb_series   add column external_ids jsonb not null default '{}'::jsonb;
alter table books       add column external_ids jsonb not null default '{}'::jsonb;
alter table authors     add column external_ids jsonb not null default '{}'::jsonb;

create index nb_books_external_ids_gin   on nb_books   using gin (external_ids jsonb_path_ops);
create index nb_authors_external_ids_gin on nb_authors using gin (external_ids jsonb_path_ops);
create index nb_series_external_ids_gin  on nb_series  using gin (external_ids jsonb_path_ops);
create index books_external_ids_gin      on books      using gin (external_ids jsonb_path_ops);
create index authors_external_ids_gin    on authors    using gin (external_ids jsonb_path_ops);

-- ============================================================
-- 2. pg_trgm for fuzzy title matching in the match step
-- ============================================================

create extension if not exists pg_trgm;

create index nb_books_title_trgm on nb_books using gin (title gin_trgm_ops);
create index books_title_trgm    on books    using gin (title gin_trgm_ops);

-- ============================================================
-- 3. Embedding input-hash for delta re-embedding
-- ============================================================
-- Lets embed-delta.ts skip books whose embedding input string hasn't changed.

alter table nb_book_embeddings add column input_hash text;
create index nb_book_embeddings_input_hash_idx on nb_book_embeddings (input_hash);

-- ============================================================
-- 4. Run tracking
-- ============================================================

create table nb_external_source_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,                -- 'isfdb' | 'sffrd'
  version text,                          -- dump date / crawl snapshot id
  mode text not null default 'delta',    -- 'full' | 'delta'
  status text not null default 'running',-- running | completed | failed | skipped_no_change
  downloaded_at timestamptz,
  imported_at timestamptz,
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now()
);

create index nb_ext_runs_provider_idx on nb_external_source_runs (provider, created_at desc);

-- ============================================================
-- 5. Awards (ISFDB-derived)
-- ============================================================

create table nb_book_awards (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references nb_books(id) on delete cascade,
  award_name text not null,
  category text,
  year int,
  result text not null default 'won',    -- won | nominee | shortlist
  source text not null default 'isfdb',
  created_at timestamptz not null default now(),
  unique (book_id, award_name, category, year)
);

create index nb_book_awards_book_idx on nb_book_awards (book_id);
create index nb_book_awards_name_year_idx on nb_book_awards (award_name, year);

-- ============================================================
-- 6. RLS
-- ============================================================

alter table nb_book_awards          enable row level security;
alter table nb_external_source_runs enable row level security;

create policy "nb_read_global" on nb_book_awards for select to authenticated using (true);
-- nb_external_source_runs: no select/insert policy -> service role only.
