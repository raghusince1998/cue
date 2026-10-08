-- Waiting on others.
--
-- After a meeting, half of what was agreed is somebody else's to do. A
-- "waiting on" item is a date to check in with that person, not time on the
-- calendar: it claims no slot and is never "dropped" — it has its own list.

-- The person it is waiting on, by name. Null for everything else.
alter table commitments
  add column if not exists waiting_on text;

-- Follow-ups made by the meeting wrap-up before this column existed were
-- titled "Waiting on Ravi: signed contract". Give them the name.
update commitments
  set waiting_on = substring(title from '^Waiting on ([^:]{1,100}):')
  where waiting_on is null
    and title ~ '^Waiting on [^:]{1,100}:';

create index if not exists commitments_waiting_idx
  on commitments (user_id, due_at)
  where waiting_on is not null and status = 'pending';
