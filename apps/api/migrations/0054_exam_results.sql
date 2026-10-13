-- Results. An exam's reservation category, for reading cut-offs. A result
-- list's roll numbers, read once from its PDF (a public list), so each
-- person's number can be looked for in it. And each look: which exam, which
-- list, whether the number was there and on which page — what the exam's
-- page shows under Results.
alter table exams add column if not exists category text;

create table if not exists notice_lists (
  notice_id uuid primary key references notices(id) on delete cascade,
  -- One array per page, so a find can say where.
  pages jsonb not null,
  numbers integer not null,
  read_at timestamptz not null default now()
);

create table if not exists exam_list_checks (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  notice_id uuid not null references notices(id) on delete cascade,
  found boolean not null,
  page integer,
  checked_at timestamptz not null default now(),
  unique (exam_id, notice_id)
);
