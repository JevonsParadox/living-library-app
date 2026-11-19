-- Enable pgvector for semantic embeddings (Block C, Commit 1).
-- Stores one vector per book, model-tagged so we can compare runs if we ever
-- swap providers. HNSW index for fast cosine-similarity nearest-neighbour.

create extension if not exists vector;

create table if not exists nb_book_embeddings (
  book_id uuid primary key references nb_books(id) on delete cascade,
  embedding vector(1536) not null,
  model text not null default 'text-embedding-3-small',
  created_at timestamptz not null default now()
);

create index if not exists nb_book_embeddings_hnsw
  on nb_book_embeddings using hnsw (embedding vector_cosine_ops);
