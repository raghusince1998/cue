-- Money people owe you: their share of an expense you paid, or money lent.
--
-- A share of an expense comes off what is claimed from the company, so a cab
-- split with a colleague is claimed once, not twice. The person is kept by
-- name as well as by link, so someone not saved as a contact can still owe
-- you, and deleting a contact does not forget the debt.
create table if not exists money_owed (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  person_name text not null,
  expense_id uuid references expenses(id) on delete cascade,
  amount_paise integer not null,
  note text,
  status text not null default 'owed',
  asked_at timestamptz,
  ask_count integer not null default 0,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table money_owed drop constraint if exists money_owed_amount_sane;
alter table money_owed
  add constraint money_owed_amount_sane check (amount_paise > 0 and amount_paise <= 1000000000);
alter table money_owed drop constraint if exists money_owed_status_known;
alter table money_owed
  add constraint money_owed_status_known check (status in ('owed', 'paid'));

create index if not exists money_owed_user_idx on money_owed (user_id, status);
create index if not exists money_owed_expense_idx on money_owed (expense_id) where expense_id is not null;

-- Where people can send it: put in the reminder, so paying back is one tap.
alter table users add column if not exists upi_id text;
