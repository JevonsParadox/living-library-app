-- Migration 00350: Engagement-score rollup.
-- Aggregates nb_popularity_signals (weighted) into nb_books.engagement_score
-- over a sliding window. Intended to be called every 10 min by Vercel cron
-- post-deploy (and manually during dev for testing).

create or replace function nb_rollup_engagement(p_window_days int default 90)
returns table(rows_updated bigint)
language plpgsql
security definer
as $$
declare
  v_updated bigint;
begin
  with agg as (
    select work_id, sum(weight)::numeric as score
      from nb_popularity_signals
     where occurred_at > now() - (p_window_days || ' days')::interval
     group by work_id
  ),
  applied as (
    update nb_books b
       set engagement_score = coalesce(agg.score, 0)
      from agg
     where b.id = agg.work_id
       and b.engagement_score is distinct from coalesce(agg.score, 0)
    returning b.id
  )
  select count(*) into v_updated from applied;

  -- Books that WERE in agg last window but now have no recent signals get zeroed.
  update nb_books
     set engagement_score = 0
   where engagement_score > 0
     and id not in (
       select work_id from nb_popularity_signals
        where occurred_at > now() - (p_window_days || ' days')::interval
     );

  return query select v_updated;
end;
$$;

grant execute on function nb_rollup_engagement(int) to service_role;
revoke execute on function nb_rollup_engagement(int) from public, anon, authenticated;
