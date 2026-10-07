-- A commitment can name a place without that place being a saved record, the
-- same way a trip can. "Event in Jaipur" needs a location long before Jaipur is
-- a Place row with coordinates.
alter table commitments
  add column if not exists place_label text;

-- Trips resolve to coordinates too, so travel between them can be estimated.
alter table trips
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table commitments
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- Geocoding the same city on every conflict check would be both slow and rude
-- to a free public service. Resolved once, kept forever — city coordinates do
-- not move.
create table if not exists geocode_cache (
  label text primary key,
  lat double precision,
  lng double precision,
  display_name text,
  -- Null coordinates are cached too: a label nobody can resolve should not be
  -- retried on every keystroke.
  resolved boolean not null default true,
  created_at timestamptz not null default now()
);
