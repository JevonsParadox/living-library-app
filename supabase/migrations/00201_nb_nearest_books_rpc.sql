-- RPC: top-K nearest semantic neighbours for a given book.
-- Returns book_id + cosine distance (0 = identical, 2 = opposite).
-- Used by scripts/nebula/build-similarity-edges.ts to populate
-- semantic_similarity edges in nb_book_edges, and at runtime by
-- the "By feel" similar-reads toggle.

create or replace function nb_nearest_books(
  p_book_id uuid,
  p_k int
)
returns table (book_id uuid, distance float)
language sql
stable
as $$
  select e.book_id, (e.embedding <=> q.embedding) as distance
  from nb_book_embeddings e,
       (select embedding from nb_book_embeddings where book_id = p_book_id) q
  order by e.embedding <=> q.embedding
  limit p_k
$$;
