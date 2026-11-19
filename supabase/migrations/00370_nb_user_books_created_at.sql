-- 00370 — Add created_at to nb_user_books for D6 reading-trail comet.
--
-- The original schema in 00100 stored started_at / finished_at / read_at
-- (event timestamps the user logs after the fact) but no row-level
-- created_at. D6 needs to know "when was this book added to the shelf"
-- to render the trail through the most-recent N additions.
--
-- The DO block backfills only on the *first* migration run by checking
-- whether the column was just added; subsequent runs are no-ops.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'nb_user_books' and column_name = 'created_at'
  ) then
    alter table nb_user_books
      add column created_at timestamptz not null default now();

    -- Backfill existing rows: prefer started_at (date a user picked up
    -- the book) → finished_at → read_at → now(). Cast date → timestamptz
    -- lands at midnight UTC; precise minute doesn't matter since these
    -- are all retrospective entries with day-level granularity.
    update nb_user_books
    set created_at = coalesce(
      started_at::timestamptz,
      finished_at::timestamptz,
      read_at::timestamptz,
      now()
    );
  end if;
end $$;

create index if not exists nb_user_books_user_created_idx
  on nb_user_books (user_id, created_at desc);
