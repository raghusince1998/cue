-- Until now every item was a single instant plus a duration capped at 8 hours,
-- so "3-day training in Mathura" could not be represented at all.
--
-- Two additions rather than one: `ends_at` carries anything longer than a day,
-- and `all_day` records that the time of day is meaningless so the UI shows
-- "Mon-Wed" instead of "09:00". A trip has a shape, not a start time.
alter table commitments
  add column if not exists all_day boolean not null default false,
  add column if not exists ends_at timestamptz;

-- Guards the invariant rather than trusting every call site to remember it.
alter table commitments
  drop constraint if exists commitments_ends_after_due;
alter table commitments
  add constraint commitments_ends_after_due
  check (ends_at is null or ends_at > due_at);

-- Overlap queries filter on the span, so both ends want to be indexed.
create index if not exists commitments_span_idx
  on commitments (user_id, status, due_at, ends_at);
