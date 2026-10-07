-- A trip is not a thing to do — it is a period with a place attached, that
-- other things belong to. That containment is a relationship, not an
-- attribute, which is why it earns its own table rather than another flag on
-- commitments.
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- Free text, because you plan a trip to "Mathura" long before it is a saved
  -- place with coordinates.
  place_label text not null,
  place_id uuid references places(id) on delete set null,
  starts_on date not null,
  ends_on date not null,
  -- 'strict'   -> I will be there the whole time; elsewhere is a real conflict
  -- 'flexible' -> mostly there, day trips possible
  -- 'tentative'-> expect to be there, plans may change
  strictness text not null default 'flexible',
  notes text,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  constraint trips_ends_after_start check (ends_on >= starts_on)
);

create index if not exists trips_user_dates_idx on trips (user_id, starts_on, ends_on);

-- "When I go to Mathura, remind me to buy peda."
--
-- Deliberately NOT a reminder for tomorrow. It is a standing intention with no
-- date at all, which surfaces the moment a trip to that place exists.
create table if not exists intentions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- The context that makes it relevant, matched case-insensitively.
  place_label text not null,
  place_id uuid references places(id) on delete set null,
  title text not null,
  notes text,
  preferred_window text,
  duration_minutes integer not null default 60,
  priority text not null default 'nice_to_have',
  -- 'saved' -> waiting for a trip; 'scheduled' -> became a real plan
  status text not null default 'saved',
  -- Set when scheduled, so completing the plan can close the intention.
  commitment_id uuid references commitments(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The lookup that powers "you have 3 things saved for Mathura".
create index if not exists intentions_place_idx
  on intentions (user_id, lower(place_label), status);

-- Things attached to a trip. Deliberately on delete set null: deleting a trip
-- must not silently delete the dentist appointment you attached to it.
alter table commitments
  add column if not exists trip_id uuid references trips(id) on delete set null;

create index if not exists commitments_trip_idx on commitments (trip_id);
