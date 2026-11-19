-- ============================================================
-- Migration 00003: Create edges and authors tables, migrate data
-- ============================================================

-- 1. Authors table
create table authors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  bio text,
  created_at timestamptz not null default now()
);

-- 2. Edges table
create table edges (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  target_type text not null,
  target_id text not null,
  edge_type text not null,
  weight float not null default 1.0,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  unique (source_type, source_id, target_type, target_id, edge_type)
);

-- 3. Indexes on edges
create index edges_source_idx on edges(source_type, source_id);
create index edges_target_idx on edges(target_type, target_id);
create index edges_type_idx on edges(edge_type);
create index edges_source_type_idx on edges(source_type, source_id, edge_type);

-- 4. RLS on authors
alter table authors enable row level security;

create policy "Anyone can read authors"
  on authors for select
  to authenticated
  using (true);

create policy "Authenticated users can insert authors"
  on authors for insert
  to authenticated
  with check (true);

-- 5. RLS on edges
alter table edges enable row level security;

-- SELECT: users can read their own edges + all wrote edges (system data)
create policy "Users can read own edges"
  on edges for select
  to authenticated
  using (
    source_id = auth.jwt() ->> 'sub'
    or edge_type = 'wrote'
  );

-- INSERT: users can only create edges where they are the source
create policy "Users can insert own edges"
  on edges for insert
  to authenticated
  with check (source_id = auth.jwt() ->> 'sub');

-- UPDATE: users can only update their own edges
create policy "Users can update own edges"
  on edges for update
  to authenticated
  using (source_id = auth.jwt() ->> 'sub');

-- DELETE: users can only delete their own edges
create policy "Users can delete own edges"
  on edges for delete
  to authenticated
  using (source_id = auth.jwt() ->> 'sub');

-- 6. Populate authors from distinct books.author values
insert into authors (name)
select distinct author from books
where author is not null and author != ''
on conflict (name) do nothing;

-- 7. Create wrote edges (author → book)
insert into edges (source_type, source_id, target_type, target_id, edge_type)
select
  'author',
  a.id::text,
  'book',
  b.id::text,
  'wrote'
from books b
join authors a on a.name = b.author
on conflict (source_type, source_id, target_type, target_id, edge_type) do nothing;

-- 8. Migrate user_books into edges
insert into edges (source_type, source_id, target_type, target_id, edge_type, metadata, created_at)
select
  'user',
  ub.user_id,
  'book',
  ub.book_id::text,
  case ub.status
    when 'unread' then 'owns'
    when 'reading' then 'reading'
    when 'read' then 'read'
    when 'wishlist' then 'wishlist'
  end,
  jsonb_strip_nulls(jsonb_build_object(
    'rating', ub.rating,
    'notes', ub.notes
  )),
  ub.added_at
from user_books ub
on conflict (source_type, source_id, target_type, target_id, edge_type) do nothing;
