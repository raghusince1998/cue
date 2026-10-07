-- Cancelling and deleting are not the same thing.
--
-- They had collapsed into one. Marking something cancelled dropped it off the
-- calendar entirely and filed it under "let go", while deleting it wiped the
-- row and left no trace at all. Both were wrong, and in opposite directions.
--
-- A cancelled meeting is a real thing that still belongs on Tuesday: seeing it
-- struck through is how you know the slot is free and why. Deleting is the
-- gesture that means "off my list" — and that is the one worth remembering,
-- because what you keep abandoning is a pattern.
--
-- So: status gains 'deleted', and each terminal state gets the one thing the
-- timeline actually needs — the moment you decided it.
alter table commitments add column if not exists cancelled_at timestamptz;
alter table commitments add column if not exists deleted_at timestamptz;

-- Rows cancelled before this migration have no recorded moment. Their due time
-- is the best available guess, clamped to now so a cancellation never lands in
-- the future — "what happened" containing next Tuesday is nonsense.
update commitments
   set cancelled_at = least(due_at, now())
 where status = 'cancelled' and cancelled_at is null;

-- Every list query now carries "not deleted", so it is worth an index.
create index if not exists commitments_live_idx
  on commitments (org_id, due_at)
  where status <> 'deleted';
