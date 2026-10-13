-- Preparing for exams. The language Cue speaks to someone in, for the exam
-- module first (en | hi). A study plan's series, linked to its exam so the
-- exam's page can show them and stop them. And mock test scores, one row
-- each, for a trend on the exam's page.
alter table users add column if not exists language text not null default 'en';
alter table recurrences add column if not exists exam_id uuid references exams(id) on delete set null;
create index if not exists recurrences_exam_idx on recurrences (exam_id) where exam_id is not null;

create table if not exists exam_mocks (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  taken_on date not null,
  score double precision not null,
  out_of double precision not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists exam_mocks_exam_idx on exam_mocks (exam_id, taken_on);
