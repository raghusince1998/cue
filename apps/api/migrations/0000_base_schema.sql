-- The tables everything else was built on top of.
--
-- This migration is numbered 0000 because it should always have been first,
-- and was missing. The original schema was created by `drizzle-kit push`
-- before that tool turned out to be broken against PostgreSQL 18 and was
-- replaced by this hand-written runner. Every migration from 0001 onwards
-- therefore assumed these tables already existed — true on the machine where
-- they were written, and false on any new one.
--
-- The consequence was that a fresh deploy following the README could not work:
-- `npm run db:migrate` on an empty database failed at 0001 with
-- `relation "commitments" does not exist`. It surfaced when the API test
-- harness first tried to build a database from nothing, which is exactly the
-- thing a deploy does and nothing had ever done since.
--
-- Only the columns that predate 0001 are here. Everything added later is added
-- by the migration that introduced it, so the chain stays honest and running it
-- on a fresh database produces the same shape as an upgraded one. Every
-- statement is `if not exists`, so this is a no-op on a database that already
-- has these tables.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  email text not null,
  password_hash text not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_unique on users (email);

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  -- Free text on purpose: "clinic", "site", "office" — the app stays generic.
  kind text,
  address text,
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null default 150,
  created_at timestamptz not null default now()
);

create index if not exists places_org_idx on places (org_id);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  place_id uuid references places(id) on delete set null,
  name text not null,
  role text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create index if not exists contacts_org_idx on contacts (org_id);
create index if not exists contacts_place_idx on contacts (org_id, place_id);

-- One visit, call or meeting.
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  place_id uuid references places(id) on delete set null,
  contact_name text,
  purpose text not null default 'unknown',
  outcome text,
  notes text,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists interactions_org_started_idx on interactions (org_id, started_at);

-- The thing you promised to do next. This is what the app exists to protect.
create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  interaction_id uuid references interactions(id) on delete set null,
  place_id uuid references places(id) on delete set null,
  title text not null,
  kind text not null default 'followup',
  due_at timestamptz not null,
  status text not null default 'pending',
  -- How many times the nag engine has already chased this one.
  escalation_count integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists commitments_org_status_due_idx on commitments (org_id, status, due_at);

-- A single scheduled buzz. One commitment produces a chain of these.
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  commitment_id uuid not null references commitments(id) on delete cascade,
  fire_at timestamptz not null,
  status text not null default 'pending',
  attempt integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reminders_due_idx on reminders (status, fire_at);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create unique index if not exists push_endpoint_unique on push_subscriptions (endpoint);
