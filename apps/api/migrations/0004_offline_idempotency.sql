-- A visit queued offline may be replayed: the phone can send it, lose signal
-- before the response arrives, and send it again on the next sync. The client
-- generates this id once at capture time, so the retry lands on the same row
-- instead of creating a second visit.
alter table interactions
  add column if not exists client_id uuid;

create unique index if not exists interactions_client_id_unique
  on interactions (org_id, client_id)
  where client_id is not null;
