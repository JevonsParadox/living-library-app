-- Migration 00360: Admin review queue for duplicate detection + atomic merge.
--
-- Two flows populate this queue:
--   1. The audit script (scripts/nebula/audit-duplicates.ts) scans existing
--      nb_books for likely-duplicate pairs using embedding cosine + trigram.
--      source = 'duplicate'.
--   2. The live createShellFromProvider path: when resolveWork returns a
--      gray-zone fuzzy match (similarity 0.60-0.78), the user gets a fresh
--      shell AND a queue row is recorded so an admin can later merge.
--      source = 'external_match'.

create table nb_review_queue (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'duplicate', -- 'duplicate' | 'external_match'
  canonical_work_id uuid references nb_books(id) on delete cascade,
  duplicate_work_id uuid references nb_books(id) on delete cascade,
  -- For 'external_match' rows where there's no duplicate row yet (or for
  -- richer context in the UI), we capture the incoming candidate inline.
  incoming_title text,
  incoming_author text,
  incoming_isbn_13 text,
  incoming_external_ids jsonb,
  similarity numeric(4,3),
  signal_breakdown jsonb,
  status text not null default 'pending',
    -- pending | merged | dismissed | created_separate
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  unique (canonical_work_id, duplicate_work_id, source)
);

create index nb_review_queue_status_idx on nb_review_queue (status, created_at desc);
create index nb_review_queue_canonical_idx on nb_review_queue (canonical_work_id);
create index nb_review_queue_source_idx on nb_review_queue (source);

alter table nb_review_queue enable row level security;
-- Service-role only; the admin UI calls server actions which use the service client.

-- ============================================================
-- nb_merge_works: atomic merge of one nb_books row into another.
-- ============================================================
create or replace function nb_merge_works(p_canonical_id uuid, p_duplicate_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_canonical_external jsonb;
  v_duplicate_external jsonb;
begin
  if p_canonical_id is null or p_duplicate_id is null then
    raise exception 'canonical_id and duplicate_id are required';
  end if;
  if p_canonical_id = p_duplicate_id then
    raise exception 'canonical and duplicate are the same work';
  end if;

  -- nb_user_books: where the user owns BOTH, drop the duplicate's row first
  -- so the upsert below doesn't violate unique(user_id, book_id).
  delete from nb_user_books
   where book_id = p_duplicate_id
     and user_id in (select user_id from nb_user_books where book_id = p_canonical_id);
  update nb_user_books set book_id = p_canonical_id where book_id = p_duplicate_id;

  -- Tags, awards, editions, signals, source_records: redirect to canonical.
  update nb_book_tags          set book_id = p_canonical_id where book_id = p_duplicate_id;
  update nb_book_awards        set book_id = p_canonical_id where book_id = p_duplicate_id;
  update nb_editions           set work_id = p_canonical_id where work_id = p_duplicate_id;
  update nb_popularity_signals set work_id = p_canonical_id where work_id = p_duplicate_id;
  update nb_source_records     set work_id = p_canonical_id where work_id = p_duplicate_id;

  -- One-row-per-work tables: keep canonical's, drop duplicate's so the
  -- ON DELETE CASCADE doesn't fight us.
  delete from nb_book_features      where book_id  = p_duplicate_id;
  delete from nb_book_embeddings    where book_id  = p_duplicate_id;
  delete from nb_book_coordinates   where book_id  = p_duplicate_id;
  delete from nb_enrichment_status  where work_id  = p_duplicate_id;
  delete from nb_enrichment_jobs    where work_id  = p_duplicate_id;
  delete from nb_book_authors       where book_id  = p_duplicate_id;

  -- Recommendation cache + similar-book edges referenced by id-as-text or uuid.
  -- nb_book_edges has both source/target — clean up rows mentioning duplicate.
  delete from nb_book_edges where source_book_id = p_duplicate_id or target_book_id = p_duplicate_id;
  delete from nb_recommendation_cache where book_id = p_duplicate_id;

  -- Concatenate external_ids JSONB onto canonical so identifiers from both
  -- providers are reachable. Right-side wins on overlapping keys.
  select external_ids into v_canonical_external from nb_books where id = p_canonical_id;
  select external_ids into v_duplicate_external from nb_books where id = p_duplicate_id;
  update nb_books
     set external_ids = coalesce(v_canonical_external, '{}'::jsonb)
                        || coalesce(v_duplicate_external, '{}'::jsonb)
   where id = p_canonical_id;

  -- Drop the duplicate.
  delete from nb_books where id = p_duplicate_id;
end;
$$;

grant execute on function nb_merge_works(uuid, uuid) to service_role;
revoke execute on function nb_merge_works(uuid, uuid) from public, anon, authenticated;
