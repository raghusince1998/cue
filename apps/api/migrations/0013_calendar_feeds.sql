-- Subscribing to a calendar someone else owns the source of truth for.
--
-- One-way on purpose. Cue reads the feed and mirrors it; it never writes
-- back. That keeps the failure modes boring: a bad sync can show you a stale
-- meeting, but it can never corrupt the calendar your colleagues are looking at.
create table if not exists calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,

  label text not null,
  -- The "secret address in iCal format" is a bearer credential: anyone holding
  -- it can read the whole calendar, forever, with no sign-in. It is encrypted
  -- at rest for the same reason the AI provider key is.
  url_encrypted text not null,
  -- Enough to tell two feeds apart in the UI, and nothing more.
  url_hint text not null,

  -- Whether mirrored events also queue reminders. Off means Cue shows them
  -- for context and conflict detection but leaves the nagging to Google.
  remind boolean not null default true,

  status text not null default 'active',
  last_synced_at timestamptz,
  last_error text,
  last_event_count integer,
  last_skipped_count integer,
  -- What the feed said it was called, when it said so.
  calendar_name text,
  created_at timestamptz not null default now()
);

create index if not exists calendar_feeds_user_idx on calendar_feeds (user_id, status);

-- Where a mirrored row came from. Both cascade: if the subscription goes, so
-- does everything that only existed because of it.
alter table commitments
  add column if not exists feed_id uuid references calendar_feeds(id) on delete cascade,
  -- The VEVENT UID. Stable across syncs, which is what makes re-reading the
  -- same feed an update rather than a pile of duplicates.
  add column if not exists external_uid text;

alter table recurrences
  add column if not exists feed_id uuid references calendar_feeds(id) on delete cascade,
  add column if not exists external_uid text;

-- The dedupe key for both. Partial, so the millions of rows with no feed are
-- not forced to be unique on a pair of nulls.
create unique index if not exists commitments_feed_uid_unique
  on commitments (feed_id, external_uid)
  where feed_id is not null;

create unique index if not exists recurrences_feed_uid_unique
  on recurrences (feed_id, external_uid)
  where feed_id is not null;

-- Dates the series skips: "delete just this one" in the source calendar. Stored
-- on the rule because that is where expansion can honour them.
alter table recurrences
  add column if not exists exdates date[];
