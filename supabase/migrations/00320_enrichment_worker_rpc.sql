-- Migration 00320: Enrichment worker atomic claim RPC.
-- Adds a heartbeat column + a SECURITY DEFINER function that claims N pending
-- jobs using FOR UPDATE SKIP LOCKED so parallel workers never collide.

alter table nb_enrichment_jobs
  add column last_heartbeat timestamptz;

create index nb_jobs_heartbeat_idx
  on nb_enrichment_jobs (last_heartbeat)
  where state = 'running';

create or replace function nb_claim_enrichment_jobs(p_limit int)
returns setof nb_enrichment_jobs
language plpgsql
security definer
as $$
begin
  return query
  update nb_enrichment_jobs j
     set state = 'running',
         started_at = coalesce(j.started_at, now()),
         last_heartbeat = now(),
         attempts = j.attempts + 1
   where j.id in (
     select id
       from nb_enrichment_jobs
      where state = 'pending'
        and scheduled_for <= now()
      order by priority asc, scheduled_for asc
      limit p_limit
      for update skip locked
   )
  returning *;
end;
$$;

grant execute on function nb_claim_enrichment_jobs(int) to service_role;
revoke execute on function nb_claim_enrichment_jobs(int) from public, anon, authenticated;
