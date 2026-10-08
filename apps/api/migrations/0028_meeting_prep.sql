-- Meeting prep: what is still open from last time.
--
-- Follow-ups remember which meeting they came out of (from_commitment_id).
-- Before the next meeting with the same people or in the same series, Cue
-- shows what is still open from the earlier ones, so it is raised in the
-- meeting rather than remembered after it.

-- Whether to be told, by notification, a few minutes before such a meeting.
alter table users
  add column if not exists prep_prompts boolean not null default true;

-- Set once the "before your meeting" notification has gone.
alter table commitments
  add column if not exists prep_prompted_at timestamptz;

-- Prep reads follow-ups by the meeting they came from.
create index if not exists commitments_from_idx
  on commitments (from_commitment_id)
  where from_commitment_id is not null;
