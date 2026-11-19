-- Migration 00310: Work/edition split + enrichment machinery
--
-- Shifts from "nb_books conflates work and edition" to a work-centric model:
--   * nb_books still holds the *work* (galaxy-ready shell).
--   * nb_editions is the new edition/publication store (one work -> many editions).
--   * nb_source_records holds raw provider payloads for provenance.
--   * nb_enrichment_status tracks per-work state per concern (metadata / embedding / pricing).
--   * nb_enrichment_jobs is a Postgres-as-queue for async work.
--   * nb_popularity_signals is append-only user-engagement tallies.
--   * nb_pricing_snapshots is volatile pricing, kept out of the canonical record.
--
-- Non-breaking: nb_books.isbn_10 / nb_books.isbn_13 remain as the "primary known ISBN".
-- A later migration can deprecate them once nb_editions is backfilled.

-- ============================================================
-- 1. Editions
-- ============================================================

create table nb_editions (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references nb_books(id) on delete cascade,
  isbn_13 text,
  isbn_10 text,
  asin text,
  format text,                           -- 'hardcover' | 'paperback' | 'ebook' | 'audio' | 'other'
  publisher text,
  publication_year int,
  page_count int,
  language_code text default 'en',
  cover_image_url text,
  external_ids jsonb not null default '{}'::jsonb,
  source text,                           -- which provider this edition came from ('isfdb' | 'openlibrary' | 'google_books' | 'user_upload')
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index nb_editions_isbn13_uniq on nb_editions (isbn_13) where isbn_13 is not null;
create unique index nb_editions_isbn10_uniq on nb_editions (isbn_10) where isbn_10 is not null;
create unique index nb_editions_asin_uniq   on nb_editions (asin)    where asin    is not null;
create index nb_editions_work_idx on nb_editions (work_id);
create index nb_editions_external_ids_gin on nb_editions using gin (external_ids jsonb_path_ops);

alter table nb_editions enable row level security;
create policy "nb_read_global" on nb_editions for select to authenticated using (true);

-- ============================================================
-- 2. Source records (raw provider payloads for provenance)
-- ============================================================
-- Lets us re-derive the canonical record if merge policy changes, without re-fetching.

create table nb_source_records (
  id uuid primary key default gen_random_uuid(),
  work_id uuid references nb_books(id) on delete cascade,
  edition_id uuid references nb_editions(id) on delete cascade,
  provider text not null,                -- 'isfdb' | 'openlibrary' | 'google_books' | 'wikidata' | 'user_upload'
  provider_record_id text not null,      -- the external primary key (stringified)
  payload jsonb not null,                -- raw normalised payload we got back
  fetched_at timestamptz not null default now(),
  -- A single (provider, provider_record_id) may attach to many works/editions over time,
  -- but each fetch is a distinct snapshot.
  unique (provider, provider_record_id, fetched_at)
);

create index nb_source_records_work_idx     on nb_source_records (work_id);
create index nb_source_records_edition_idx  on nb_source_records (edition_id);
create index nb_source_records_provider_idx on nb_source_records (provider, provider_record_id);

alter table nb_source_records enable row level security;
-- service-role only; no select policy for authenticated users.

-- ============================================================
-- 3. Enrichment status (per work, per concern)
-- ============================================================
-- Each concern decays at a different rate and may be enriched independently.

create table nb_enrichment_status (
  work_id uuid primary key references nb_books(id) on delete cascade,
  metadata_status   text not null default 'shell',   -- shell | enriching | enriched | stale | failed
  embedding_status  text not null default 'shell',   -- shell | enriching | enriched | stale | failed
  coords_status     text not null default 'seeded',  -- seeded | refined | stale
  cover_status      text not null default 'missing', -- missing | present | failed
  metadata_last_enriched_at   timestamptz,
  embedding_last_enriched_at  timestamptz,
  coords_last_refined_at      timestamptz,
  metadata_next_refresh_at    timestamptz,
  last_error text,
  quality_score numeric(4,3) not null default 0,     -- 0..1 heuristic for completeness
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nb_enrichment_metadata_next_idx on nb_enrichment_status (metadata_next_refresh_at)
  where metadata_next_refresh_at is not null;
create index nb_enrichment_metadata_status_idx on nb_enrichment_status (metadata_status);

alter table nb_enrichment_status enable row level security;
create policy "nb_read_global" on nb_enrichment_status for select to authenticated using (true);

-- ============================================================
-- 4. Enrichment jobs (Postgres-as-queue)
-- ============================================================
-- Kept simple. Single worker process polls with SELECT ... FOR UPDATE SKIP LOCKED.

create table nb_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  work_id uuid references nb_books(id) on delete cascade,
  edition_id uuid references nb_editions(id) on delete cascade,
  job_type text not null,                -- 'metadata' | 'embedding' | 'coords' | 'cover' | 'pricing'
  priority int not null default 100,     -- lower = sooner (user-triggered = 10, background = 100)
  state text not null default 'pending', -- pending | running | completed | failed | dead
  attempts int not null default 0,
  max_attempts int not null default 3,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,  -- extra args (e.g. hinted isbn, source preference)
  created_at timestamptz not null default now()
);

create index nb_jobs_pending_idx on nb_enrichment_jobs (state, scheduled_for, priority)
  where state = 'pending';
create index nb_jobs_work_idx on nb_enrichment_jobs (work_id);
-- Avoid enqueuing duplicate pending jobs for the same (work, job_type).
create unique index nb_jobs_dedupe_uniq on nb_enrichment_jobs (work_id, job_type)
  where state in ('pending', 'running');

alter table nb_enrichment_jobs enable row level security;
-- service-role only.

-- ============================================================
-- 5. Popularity signals (append-only engagement counters)
-- ============================================================
-- Writes are cheap; aggregation happens in a rollup column on nb_books.

create table nb_popularity_signals (
  id bigserial primary key,
  work_id uuid not null references nb_books(id) on delete cascade,
  signal_type text not null,             -- 'view' | 'click' | 'upload' | 'search_hit' | 'wishlist' | 'read'
  user_id text,                          -- clerk sub; nullable for anon signals
  weight numeric(5,2) not null default 1.0,
  occurred_at timestamptz not null default now()
);

create index nb_pop_signals_work_idx on nb_popularity_signals (work_id, occurred_at desc);
create index nb_pop_signals_type_idx on nb_popularity_signals (signal_type, occurred_at desc);

alter table nb_popularity_signals enable row level security;
create policy "nb_pop_insert" on nb_popularity_signals for insert to authenticated with check (true);
-- No select policy: aggregates are exposed via views, raw rows are service-role only.

-- Rollup column on nb_books, maintained by the worker (cheap materialised view alternative).
alter table nb_books add column engagement_score numeric(10,4) not null default 0;
create index nb_books_engagement_idx on nb_books (engagement_score desc);

-- ============================================================
-- 6. Pricing snapshots (volatile, own TTL, never joined to galaxy feed)
-- ============================================================

create table nb_pricing_snapshots (
  id bigserial primary key,
  edition_id uuid not null references nb_editions(id) on delete cascade,
  source text not null,                  -- 'amazon' | 'abebooks' | 'isbndb' | 'user_report'
  price_cents int not null,
  currency text not null default 'USD',
  country_code text,                     -- ISO-3166-1 alpha-2
  stock_status text,                     -- 'in_stock' | 'limited' | 'out_of_stock' | 'unknown'
  affiliate_url text,
  captured_at timestamptz not null default now()
);

create index nb_pricing_edition_idx on nb_pricing_snapshots (edition_id, captured_at desc);
create index nb_pricing_fresh_idx on nb_pricing_snapshots (edition_id, source, captured_at desc);

alter table nb_pricing_snapshots enable row level security;
create policy "nb_read_global" on nb_pricing_snapshots for select to authenticated using (true);

-- ============================================================
-- 7. Backfill: every existing nb_books row gets an enrichment_status row
-- ============================================================

insert into nb_enrichment_status (work_id, metadata_status, embedding_status, coords_status, cover_status)
select
  b.id,
  case when b.description is not null and length(b.description) > 20 then 'enriched' else 'shell' end,
  case when emb.book_id is not null then 'enriched' else 'shell' end,
  case when coord.book_id is not null then 'refined' else 'seeded' end,
  case when b.cover_image_url is not null then 'present' else 'missing' end
from nb_books b
left join nb_book_embeddings  emb   on emb.book_id   = b.id
left join nb_book_coordinates coord on coord.book_id = b.id
on conflict (work_id) do nothing;
