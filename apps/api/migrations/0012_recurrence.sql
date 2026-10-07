-- Repeating plans.
--
-- The rule lives here; the occurrences it produces are ordinary rows in
-- commitments. That is the whole design: the reminder worker, conflict
-- detection, the Today screen and editing all keep working untouched, because
-- nothing downstream ever learns that recurrence exists.
--
-- The alternative — expanding a rule on every read — would have meant teaching
-- every one of those paths about virtual occurrences, and the nag engine in
-- particular has no way to queue a reminder against a row that is not there.
create table if not exists recurrences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,

  -- What each occurrence looks like. Copied onto every generated commitment,
  -- so editing the series changes future ones without touching what has been.
  title text not null,
  kind text not null default 'task',
  notes text,
  duration_minutes integer not null default 30,
  priority text not null default 'normal',
  place_id uuid references places(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  place_label text,

  -- The rule itself.
  freq text not null,
  interval integer not null default 1,
  -- 0=Sunday .. 6=Saturday. Null means "the same weekday as starts_on".
  by_weekday integer[],
  by_month_day integer,
  by_month integer,
  -- 1-4, or -1 for last: "the second Tuesday of the month".
  set_pos integer,

  -- First occurrence, and the phase for "every other week".
  starts_on date not null,
  hour integer not null default 9,
  minute integer not null default 0,
  -- Inclusive. Null runs forever.
  until_on date,
  -- Total occurrences. Null is unbounded.
  count integer,

  status text not null default 'active',
  -- How far ahead occurrences have been written, so the generator knows where
  -- to resume instead of re-deriving the whole series every time.
  materialised_to date,
  created_at timestamptz not null default now(),

  constraint recurrences_freq_valid check (freq in ('daily', 'weekly', 'monthly', 'yearly')),
  constraint recurrences_interval_positive check (interval >= 1),
  constraint recurrences_hour_valid check (hour between 0 and 23),
  constraint recurrences_minute_valid check (minute between 0 and 59)
);

create index if not exists recurrences_user_idx on recurrences (user_id, status);

alter table commitments
  -- Cascade is right here, unlike trip_id: an occurrence has no independent
  -- existence. Deleting the series should take the unstarted copies with it.
  add column if not exists recurrence_id uuid references recurrences(id) on delete cascade,
  -- The local date this occurrence stands for. Cheaper and safer to compare
  -- than due_at, which carries a time and a zone.
  add column if not exists occurrence_on date,
  -- Set once someone edits or reschedules this single occurrence. Regenerating
  -- the series then leaves it alone, which is what "change just this one" has
  -- to mean if it is to survive the next edit of the rule.
  add column if not exists detached boolean not null default false;

-- Makes generation idempotent: running it twice, or two API instances running
-- it at once, cannot produce a duplicate occurrence.
create unique index if not exists commitments_occurrence_unique
  on commitments (recurrence_id, occurrence_on)
  where recurrence_id is not null;

create index if not exists commitments_recurrence_idx on commitments (recurrence_id);
