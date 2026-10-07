-- The end-of-day prompt. Stored per user because the whole point is that it
-- fires in *their* evening, and a team can span timezones.
alter table users
  add column if not exists daily_nudge_enabled boolean not null default true,
  -- Local hour, 0-23. 19 = 7pm, late enough to be done visiting.
  add column if not exists daily_nudge_hour integer not null default 19,
  -- Local date of the last nudge, so a worker restart cannot double-send.
  add column if not exists last_nudge_on date;
