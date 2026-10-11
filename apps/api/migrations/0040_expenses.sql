-- Expenses: what was spent on the road, kept until it is claimed back.
--
-- Amounts in whole paise. Linked, where it is known, to the trip it was spent
-- on and the person or clinic it was for, so a claim can say why. A receipt
-- photo, small and compressed before it is sent, lives with the row.
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  amount_paise integer not null,
  category text not null default 'other',
  note text,
  spent_on date not null,
  trip_id uuid references trips(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  account text,
  receipt bytea,
  receipt_mime text,
  claim_status text not null default 'unclaimed',
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table expenses drop constraint if exists expenses_amount_sane;
alter table expenses
  add constraint expenses_amount_sane check (amount_paise > 0 and amount_paise <= 1000000000);
alter table expenses drop constraint if exists expenses_status_known;
alter table expenses
  add constraint expenses_status_known check (claim_status in ('unclaimed', 'claimed', 'reimbursed'));

create index if not exists expenses_user_day_idx on expenses (user_id, spent_on desc);
create index if not exists expenses_trip_idx on expenses (trip_id) where trip_id is not null;
