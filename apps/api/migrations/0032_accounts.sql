-- Accounts: the clinics and companies people work at, as things in their own
-- right.
--
-- An account exists as soon as someone's "Works at" names it; this table only
-- holds what is said about the place itself: how far along things are, and
-- notes. It is keyed by name, compared without case or extra spaces, the way
-- contacts.organization is matched, rather than by a foreign key that every
-- contact would have to be migrated onto.
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  stage text,
  stage_changed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists accounts_org_name_idx
  on accounts (org_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));

alter table accounts drop constraint if exists accounts_stage_known;
alter table accounts
  add constraint accounts_stage_known
  check (stage is null or stage in ('prospect', 'talking', 'proposal', 'customer', 'lost'));
