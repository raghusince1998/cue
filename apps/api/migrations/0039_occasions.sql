-- Occasions: birthdays and anniversaries on people, and festival greetings
-- sent across a contact list.
--
-- Dates are "MM-DD" with no year: a client's birthday is worth knowing, their
-- age is not, and few people know it anyway.
alter table contacts
  add column if not exists birthday text,
  add column if not exists anniversary text;

alter table contacts drop constraint if exists contacts_birthday_shape;
alter table contacts
  add constraint contacts_birthday_shape
  check (birthday is null or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table contacts drop constraint if exists contacts_anniversary_shape;
alter table contacts
  add constraint contacts_anniversary_shape
  check (anniversary is null or anniversary ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

-- One round of greetings: "Diwali, to everyone at Mehta Physio and Infosys".
-- Who it is for is fixed when it starts; who has been sent one is recorded as
-- it goes, so it can be put down and picked up, and nobody gets it twice.
create table if not exists greeting_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  occasion text not null,
  message text not null,
  contact_ids uuid[] not null,
  created_at timestamptz not null default now()
);
create index if not exists greeting_runs_user_idx on greeting_runs (user_id, created_at desc);

create table if not exists greeting_sends (
  run_id uuid not null references greeting_runs(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (run_id, contact_id)
);
