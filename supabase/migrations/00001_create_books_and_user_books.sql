-- Books: global metadata (shared across all users)
create table books (
  id uuid primary key default gen_random_uuid(),
  isbn text unique,
  title text not null,
  author text not null,
  cover_url text,
  publisher text,
  published_year smallint,
  page_count smallint,
  description text,
  created_at timestamptz not null default now()
);

-- User books: a user's copy of a book
create table user_books (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  book_id uuid not null references books(id) on delete cascade,
  status text not null default 'unread' check (status in ('unread', 'reading', 'read', 'wishlist')),
  rating smallint check (rating between 1 and 5),
  notes text,
  added_at timestamptz not null default now(),
  unique (user_id, book_id)
);

-- Indexes
create index user_books_user_id_idx on user_books(user_id);
create index user_books_book_id_idx on user_books(book_id);

-- RLS
alter table books enable row level security;
alter table user_books enable row level security;

-- Books: anyone authenticated can read, only server/admin can insert
create policy "Anyone can read books"
  on books for select
  to authenticated
  using (true);

-- User books: users can only access their own
create policy "Users can read own books"
  on user_books for select
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create policy "Users can insert own books"
  on user_books for insert
  to authenticated
  with check (user_id = auth.jwt() ->> 'sub');

create policy "Users can update own books"
  on user_books for update
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');

create policy "Users can delete own books"
  on user_books for delete
  to authenticated
  using (user_id = auth.jwt() ->> 'sub');
