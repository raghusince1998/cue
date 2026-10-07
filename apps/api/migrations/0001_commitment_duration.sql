-- How long a commitment blocks out, so two things cannot claim the same slot.
-- 15 minutes matches the callback default, which is the most common kind.
alter table commitments
  add column if not exists duration_minutes integer not null default 15;
