-- Follow-ups from meetings.
--
-- What is agreed in a meeting is the thing most likely to be lost: it lives in
-- someone's head until the next meeting starts. After a meeting ends, Cue asks
-- what came out of it, and each answer becomes a plan of its own.

-- Whether to be asked by notification when a meeting ends. On by default:
-- the in-app prompt is always there, the notification is what makes it work.
alter table users
  add column if not exists followup_prompts boolean not null default true;

-- Set once the "any follow-ups?" notification has gone, so it goes once.
alter table commitments
  add column if not exists wrapup_prompted_at timestamptz,
  -- The meeting a follow-up came out of, so it can say so.
  add column if not exists from_commitment_id uuid references commitments(id) on delete set null;

-- The sweep looks for pending meetings that just ended and were not asked about.
create index if not exists commitments_wrapup_idx
  on commitments (due_at)
  where status = 'pending' and kind = 'meeting' and wrapup_prompted_at is null;
