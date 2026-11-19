-- RPC: find books that bridge two given regions via semantic_similarity edges.
--
-- A "bridger" is any book whose semantic_similarity neighbours include at
-- least one book in region A AND one in region B. We rank by the precomputed
-- bridge_score from nb_book_graph_metrics.
--
-- Used by app/(nebula)/nebula/actions.ts → getBridgeBooksForLibrary()

create or replace function nb_bridge_candidates(
  p_region_a uuid,
  p_region_b uuid,
  p_owned_ids uuid[],
  p_limit int default 5
)
returns table (book_id uuid, bridge_score numeric)
language sql
stable
as $$
  with edges_to_a as (
    select distinct e.source_book_id as bid
    from nb_book_edges e
    join nb_book_coordinates c on c.book_id = e.target_book_id
    where e.edge_type = 'semantic_similarity'
      and c.region_id = p_region_a
  ),
  edges_to_b as (
    select distinct e.source_book_id as bid
    from nb_book_edges e
    join nb_book_coordinates c on c.book_id = e.target_book_id
    where e.edge_type = 'semantic_similarity'
      and c.region_id = p_region_b
  ),
  bridgers as (
    select a.bid as book_id
    from edges_to_a a
    inner join edges_to_b b on a.bid = b.bid
  )
  select br.book_id, coalesce(m.bridge_score, 0)::numeric as bridge_score
  from bridgers br
  left join nb_book_graph_metrics m on m.book_id = br.book_id
  where not (br.book_id = any(coalesce(p_owned_ids, array[]::uuid[])))
  order by coalesce(m.bridge_score, 0) desc
  limit p_limit;
$$;
