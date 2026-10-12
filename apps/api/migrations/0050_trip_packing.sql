-- A trip's packing list: a plan on the trip ("Pack for Goa", the evening
-- before) whose checklist is the list. Remembered on the trip so it is made
-- once and found again; gone with the plan if the plan is deleted.
alter table trips add column if not exists packing_id uuid references commitments(id) on delete set null;
