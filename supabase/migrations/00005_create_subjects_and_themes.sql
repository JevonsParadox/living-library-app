-- ============================================================
-- Migration 00005: Create subjects and themes tables
-- ============================================================

-- Subjects: broad categories (History, Science, Fiction, etc.)
create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Themes: specific ideas or threads (dystopia, cognitive bias, etc.)
create table themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- RLS
alter table subjects enable row level security;
alter table themes enable row level security;

create policy "Anyone can read subjects"
  on subjects for select
  to authenticated
  using (true);

create policy "Authenticated users can insert subjects"
  on subjects for insert
  to authenticated
  with check (true);

create policy "Anyone can read themes"
  on themes for select
  to authenticated
  using (true);

create policy "Authenticated users can insert themes"
  on themes for insert
  to authenticated
  with check (true);

-- Update edges RLS to allow belongs_to and linked_to inserts
drop policy "Users can insert own or wrote edges" on edges;

create policy "Users can insert own or system edges"
  on edges for insert
  to authenticated
  with check (
    source_id = auth.jwt() ->> 'sub'
    or edge_type in ('wrote', 'belongs_to', 'linked_to')
  );

-- Update edges SELECT to also allow reading belongs_to and linked_to
drop policy "Users can read own edges" on edges;

create policy "Users can read own and system edges"
  on edges for select
  to authenticated
  using (
    source_id = auth.jwt() ->> 'sub'
    or edge_type in ('wrote', 'belongs_to', 'linked_to')
  );
