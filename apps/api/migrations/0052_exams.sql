-- Exams someone has applied for, or means to: a government job, an entrance
-- test. Where each stands (form to fill, applied, a round, the result), the
-- numbers it is known by, and the centre once an admit card says. Its dates —
-- the last day to apply, the fee, the exam, the result — are ordinary plans,
-- linked by exam_id, with exam_step saying which date each one is.
-- Nothing here is a portal password, an OTP or a date of birth: Cue never asks.
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  exam_key text,
  name text not null,
  cycle text,
  region text,
  registration_no text,
  roll_no text,
  stage text not null default 'applied',
  stage_changed_at timestamptz not null default now(),
  centre_name text,
  centre_address text,
  centre_city text,
  notes text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists exams_user_idx on exams (user_id);

alter table commitments add column if not exists exam_id uuid references exams(id) on delete set null;
alter table commitments add column if not exists exam_step text;
create index if not exists commitments_exam_idx on commitments (exam_id) where exam_id is not null;
