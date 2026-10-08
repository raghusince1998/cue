-- The morning brief: the day's shape, before the day starts.
--
-- The evening nudge asks what happened; this says what is coming. One
-- notification at a chosen local hour: meetings, the first of them, the
-- longest free stretch, who to chase, and what is left over.
alter table users
  add column if not exists morning_brief_enabled boolean not null default true,
  -- Local hour, 0-23.
  add column if not exists morning_brief_hour integer not null default 8,
  -- Local date of the last brief, so a restart cannot send two.
  add column if not exists last_brief_on date;
