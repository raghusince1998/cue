-- The distinction the whole planner rests on: is this a real appointment at a
-- real time, or something that merely needs to happen sometime?
--
-- "Call plumber this afternoon" is not a 2pm meeting. Treating it as one is
-- what makes ordinary planners feel like they are lying to you — they invent a
-- precision the user never gave them.
alter table commitments
  -- 'fixed'    -> occupies a slot, clashes with other fixed things
  -- 'flexible' -> wants a window, never reports a clash
  add column if not exists flexibility text not null default 'fixed',
  -- 'morning' | 'afternoon' | 'evening' | 'night' | null
  add column if not exists preferred_window text,
  -- Must happen by this moment, even if the exact time is undecided.
  add column if not exists deadline timestamptz,
  -- 'critical' | 'high' | 'normal' | 'low' | 'nice_to_have'
  add column if not exists priority text not null default 'normal';

-- Personal definitions of "evening" differ; null means use the shared defaults.
alter table users
  add column if not exists time_windows jsonb;

-- The agenda filters on these constantly.
create index if not exists commitments_flex_idx
  on commitments (user_id, status, flexibility, due_at);
