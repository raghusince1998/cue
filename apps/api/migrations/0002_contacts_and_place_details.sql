-- Business details discovered from a location provider, plus a phone number so
-- a place can be called even before anyone is recorded as a contact there.
alter table places
  add column if not exists phone text,
  add column if not exists category text,
  -- 'manual' | 'osm' | 'google' — where the details came from.
  add column if not exists source text not null default 'manual',
  -- Provider's own id, so re-importing the same POI updates instead of duplicating.
  add column if not exists external_id text;

alter table contacts
  add column if not exists notes text;

-- Interactions and commitments point at a real contact record now. The old
-- free-text contact_name stays as a fallback for anything logged before this.
alter table interactions
  add column if not exists contact_id uuid references contacts(id) on delete set null;

alter table commitments
  add column if not exists contact_id uuid references contacts(id) on delete set null;

create index if not exists contacts_place_idx on contacts (org_id, place_id);
create index if not exists places_external_idx on places (org_id, source, external_id);
