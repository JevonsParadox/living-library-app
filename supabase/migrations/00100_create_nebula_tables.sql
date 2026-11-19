-- Migration 00100: Project Nebula — Sci-Fi/Fantasy 3D Semantic Library
-- All tables prefixed nb_ to isolate from the main Universe schema.
-- Based on the Semantic 3D Library Technical Design Packet.
-- pgvector extension deferred to a later migration when embeddings are needed.

-- ============================================================
-- CORE TABLES
-- ============================================================

create table nb_authors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_name text,
  bio text,
  nationality text,
  birth_year int,
  death_year int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  description text,
  popularity_score numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  slug text unique,
  description text,
  short_description text,
  publication_year int,
  original_publication_year int,
  page_count int,
  language_code text default 'en',
  isbn_10 text,
  isbn_13 text,
  asin text,
  cover_image_url text,
  canonical_genre text,
  age_audience text,
  popularity_score numeric(8,4) not null default 0,
  quality_score numeric(8,4) not null default 0,
  series_id uuid references nb_series(id) on delete set null,
  series_order numeric(8,2),
  primary_author_id uuid references nb_authors(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_book_authors (
  book_id uuid not null references nb_books(id) on delete cascade,
  author_id uuid not null references nb_authors(id) on delete cascade,
  role text not null default 'author',
  ordinal int not null default 1,
  primary key (book_id, author_id, role)
);

create table nb_book_tags (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references nb_books(id) on delete cascade,
  tag_type text not null,
  tag_value text not null,
  source text not null,
  weight numeric(8,4) not null default 1,
  created_at timestamptz not null default now()
);

create table nb_book_features (
  book_id uuid primary key references nb_books(id) on delete cascade,
  fantasy_scifi_score numeric(8,4) not null default 0,
  softness_hardness_score numeric(8,4) not null default 0,
  intimacy_epic_score numeric(8,4) not null default 0,
  darkness_coziness_score numeric(8,4) not null default 0,
  literary_plot_score numeric(8,4) not null default 0,
  romance_intensity_score numeric(8,4) not null default 0,
  political_adventure_score numeric(8,4) not null default 0,
  weirdness_score numeric(8,4) not null default 0,
  pacing_score numeric(8,4) not null default 0,
  worldbuilding_density_score numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SPATIAL / GRAPH TABLES
-- ============================================================

create table nb_regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  description text,
  anchor_x numeric(12,6) not null,
  anchor_y numeric(12,6) not null,
  anchor_z numeric(12,6) not null,
  color_hex text,
  icon_name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_clusters (
  id uuid primary key default gen_random_uuid(),
  parent_cluster_id uuid references nb_clusters(id) on delete set null,
  region_id uuid references nb_regions(id) on delete set null,
  level text not null,
  name text not null,
  description text,
  centroid_x numeric(12,6),
  centroid_y numeric(12,6),
  centroid_z numeric(12,6),
  radius numeric(12,6),
  density_score numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_book_cluster_membership (
  book_id uuid not null references nb_books(id) on delete cascade,
  cluster_id uuid not null references nb_clusters(id) on delete cascade,
  membership_role text not null default 'member',
  confidence numeric(8,4) not null default 1,
  primary key (book_id, cluster_id)
);

create table nb_book_coordinates (
  book_id uuid primary key references nb_books(id) on delete cascade,
  layout_version text not null default 'v1',
  region_id uuid references nb_regions(id) on delete set null,
  primary_cluster_id uuid references nb_clusters(id) on delete set null,
  x numeric(12,6) not null,
  y numeric(12,6) not null,
  z numeric(12,6) not null,
  local_radius numeric(12,6),
  stability_score numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_book_edges (
  id uuid primary key default gen_random_uuid(),
  source_book_id uuid not null references nb_books(id) on delete cascade,
  target_book_id uuid not null references nb_books(id) on delete cascade,
  edge_type text not null,
  score numeric(8,4) not null default 1,
  rank int,
  explanation jsonb,
  created_at timestamptz not null default now(),
  unique (source_book_id, target_book_id, edge_type)
);

create table nb_book_graph_metrics (
  book_id uuid primary key references nb_books(id) on delete cascade,
  bridge_score numeric(8,4) not null default 0,
  centrality_score numeric(8,4) not null default 0,
  outlier_score numeric(8,4) not null default 0,
  series_anchor_score numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- USER TABLES
-- ============================================================

create table nb_user_books (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  book_id uuid not null references nb_books(id) on delete cascade,
  source_upload_id uuid,
  ownership_type text not null default 'owned',
  read_status text not null default 'unknown',
  rating numeric(3,1),
  started_at date,
  finished_at date,
  read_at date,
  days_to_read int generated always as (
    case
      when started_at is not null and finished_at is not null then greatest((finished_at - started_at), 0)
      else null
    end
  ) stored,
  chronology_confidence numeric(8,4) not null default 0,
  added_at timestamptz not null default now(),
  unique (user_id, book_id)
);

create table nb_user_shelf_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  upload_type text not null,
  source_file_url text,
  status text not null default 'pending',
  raw_payload jsonb,
  processing_notes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_user_upload_candidates (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references nb_user_shelf_uploads(id) on delete cascade,
  extracted_title text,
  extracted_author text,
  extracted_isbn text,
  canonical_book_id uuid references nb_books(id) on delete set null,
  confidence numeric(8,4) not null default 0,
  extraction_source text,
  status text not null default 'pending',
  raw_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_user_taste_profiles (
  user_id text primary key,
  x numeric(12,6),
  y numeric(12,6),
  z numeric(12,6),
  summary jsonb,
  updated_at timestamptz not null default now()
);

create table nb_user_taste_clusters (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text,
  centroid_x numeric(12,6),
  centroid_y numeric(12,6),
  centroid_z numeric(12,6),
  book_count int not null default 0,
  summary jsonb,
  created_at timestamptz not null default now()
);

create table nb_user_taste_cluster_books (
  user_taste_cluster_id uuid not null references nb_user_taste_clusters(id) on delete cascade,
  user_book_id uuid not null references nb_user_books(id) on delete cascade,
  primary key (user_taste_cluster_id, user_book_id)
);

create table nb_user_paths (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  algorithm_type text not null,
  chronology_mode text not null,
  path_json jsonb not null,
  stats_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nb_recommendation_cache (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  book_id uuid not null references nb_books(id) on delete cascade,
  recommendation_type text not null,
  score numeric(8,4) not null,
  reasons jsonb,
  generated_at timestamptz not null default now(),
  unique(user_id, book_id, recommendation_type)
);

create table nb_user_events (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  event_type text not null,
  event_payload jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index nb_books_isbn_13_idx on nb_books(isbn_13);
create index nb_books_isbn_10_idx on nb_books(isbn_10);
create index nb_books_genre_idx on nb_books(canonical_genre);
create index nb_books_series_idx on nb_books(series_id);
create index nb_book_edges_source_type_idx on nb_book_edges(source_book_id, edge_type);
create index nb_book_edges_target_type_idx on nb_book_edges(target_book_id, edge_type);
create index nb_book_coordinates_xyz_idx on nb_book_coordinates(x, y, z);
create index nb_user_books_user_idx on nb_user_books(user_id);
create index nb_book_tags_book_idx on nb_book_tags(book_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table nb_authors enable row level security;
alter table nb_series enable row level security;
alter table nb_books enable row level security;
alter table nb_book_authors enable row level security;
alter table nb_book_tags enable row level security;
alter table nb_book_features enable row level security;
alter table nb_regions enable row level security;
alter table nb_clusters enable row level security;
alter table nb_book_cluster_membership enable row level security;
alter table nb_book_coordinates enable row level security;
alter table nb_book_edges enable row level security;
alter table nb_book_graph_metrics enable row level security;
alter table nb_user_books enable row level security;
alter table nb_user_shelf_uploads enable row level security;
alter table nb_user_upload_candidates enable row level security;
alter table nb_user_taste_profiles enable row level security;
alter table nb_user_taste_clusters enable row level security;
alter table nb_user_taste_cluster_books enable row level security;
alter table nb_user_paths enable row level security;
alter table nb_recommendation_cache enable row level security;
alter table nb_user_events enable row level security;

-- Global data: anyone authenticated can read
create policy "nb_read_global" on nb_authors for select to authenticated using (true);
create policy "nb_read_global" on nb_series for select to authenticated using (true);
create policy "nb_read_global" on nb_books for select to authenticated using (true);
create policy "nb_read_global" on nb_book_authors for select to authenticated using (true);
create policy "nb_read_global" on nb_book_tags for select to authenticated using (true);
create policy "nb_read_global" on nb_book_features for select to authenticated using (true);
create policy "nb_read_global" on nb_regions for select to authenticated using (true);
create policy "nb_read_global" on nb_clusters for select to authenticated using (true);
create policy "nb_read_global" on nb_book_cluster_membership for select to authenticated using (true);
create policy "nb_read_global" on nb_book_coordinates for select to authenticated using (true);
create policy "nb_read_global" on nb_book_edges for select to authenticated using (true);
create policy "nb_read_global" on nb_book_graph_metrics for select to authenticated using (true);

-- User data: users can read/write their own
create policy "nb_user_books_select" on nb_user_books for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_books_insert" on nb_user_books for insert to authenticated
  with check (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_books_update" on nb_user_books for update to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_books_delete" on nb_user_books for delete to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create policy "nb_user_uploads_select" on nb_user_shelf_uploads for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_uploads_insert" on nb_user_shelf_uploads for insert to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "nb_user_candidates_select" on nb_user_upload_candidates for select to authenticated using (true);
create policy "nb_user_candidates_insert" on nb_user_upload_candidates for insert to authenticated with check (true);

create policy "nb_user_taste_select" on nb_user_taste_profiles for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_taste_insert" on nb_user_taste_profiles for insert to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "nb_user_taste_clusters_select" on nb_user_taste_clusters for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_taste_clusters_insert" on nb_user_taste_clusters for insert to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "nb_user_taste_cluster_books_select" on nb_user_taste_cluster_books for select to authenticated using (true);
create policy "nb_user_taste_cluster_books_insert" on nb_user_taste_cluster_books for insert to authenticated with check (true);

create policy "nb_user_paths_select" on nb_user_paths for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_user_paths_insert" on nb_user_paths for insert to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "nb_rec_cache_select" on nb_recommendation_cache for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
create policy "nb_rec_cache_insert" on nb_recommendation_cache for insert to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "nb_events_insert" on nb_user_events for insert to authenticated with check (true);
create policy "nb_events_select" on nb_user_events for select to authenticated
  using (user_id = auth.jwt() ->> 'sub');
