-- Official notices from exam boards' public pages: each link or table row
-- seen, once. What was already there the first time a page was read is the
-- baseline and is never announced; what appears after is proposed — which
-- exam, which dates — and waits for a person to check it against the notice
-- before anyone tracking that exam is told.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  -- The link, or for a table the row itself: how a notice is known again.
  key text not null,
  url text not null,
  title text not null,
  -- baseline | pending | unmatched | approved | dismissed
  status text not null default 'pending',
  proposals jsonb not null default '[]',
  -- Dates seen in its PDF, for the reviewer.
  hints jsonb not null default '[]',
  found_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  told integer not null default 0,
  unique (source, key)
);
create index if not exists notices_status_idx on notices (status, found_at desc);

-- How each page fared the last time it was read: for the reviewer, so a page
-- that stopped answering, or now refuses robots, is seen rather than silent.
create table if not exists notice_sources (
  id text primary key,
  checked_at timestamptz,
  ok boolean,
  message text,
  baseline_done boolean not null default false
);
