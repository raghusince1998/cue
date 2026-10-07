-- Things attached to a plan.
--
-- Shopping is the obvious case — "go shopping this evening: milk, bread, peda"
-- — but so is packing for a trip, or the three points to raise in a meeting.
-- All of it used to go into the notes as a sentence, where nothing could be
-- ticked off and the half already done looked exactly like the half still to do.
--
-- Deliberately its own table rather than a JSON column: these get ticked one at
-- a time by whoever is standing in the shop, and a row per item is what makes
-- that a single cheap write instead of a read-modify-write of the whole list.
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- Cascade: the list has no meaning without the plan it belongs to.
  commitment_id uuid not null references commitments(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  done_at timestamptz,
  -- Explicit, so the order survives reordering and ties on created_at.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists checklist_commitment_idx
  on checklist_items (commitment_id, position);
