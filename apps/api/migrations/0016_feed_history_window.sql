-- How much of a calendar's past to mirror, decided per calendar.
--
-- The window was a fixed fourteen days, which is wrong in both directions: a
-- holiday feed has no history worth keeping, while a work calendar exported
-- from Google arrives with years of real meetings that simply vanished. The
-- first person to try it uploaded a file, saw one event, and reasonably
-- concluded the import was broken.
--
-- Null means no lower bound at all — import everything the file contains.
-- Note the default backfills every existing row with 365 as the column is
-- added, which is deliberate: subscriptions set up before this migration were
-- silently losing their history, so widening them is the fix, not a surprise.
-- Anyone who wants the old fortnight can pick it per calendar.
alter table calendar_feeds
  add column if not exists history_days integer default 365;

alter table calendar_feeds
  drop constraint if exists calendar_feeds_history_days_sane;
alter table calendar_feeds
  add constraint calendar_feeds_history_days_sane
  check (history_days is null or history_days between 0 and 7300);
