-- Plans that follow a schedule rather than a rhythm.
--
-- A child's vaccinations happen at birth, 6 weeks, 10 weeks, 14 weeks,
-- 9 months… No "every N weeks" rule describes that, so a schedule is a
-- starting date and a set of steps, and each step is an ordinary commitment
-- with its own title and date. The schedule row exists to group them: to show
-- progress, and to stop what is left in one go.
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  -- What the gaps count from: a date of birth, the start of a treatment.
  starts_on date not null,
  -- 'active' | 'stopped'
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists schedules_user_idx on schedules (user_id, status);

-- A step outlives its schedule being deleted: what was done stays on record.
alter table commitments
  add column if not exists schedule_id uuid references schedules(id) on delete set null;

create index if not exists commitments_schedule_idx
  on commitments (schedule_id)
  where schedule_id is not null;
