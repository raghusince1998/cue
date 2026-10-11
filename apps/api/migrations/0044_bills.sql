-- Bills and renewals: rent, electricity, EMIs, subscriptions, and what
-- expires — a passport, a licence, a policy. Each has its next due date,
-- which moves on by its cycle when it is paid; the anchor day keeps a bill
-- due on the 31st on the 31st after a short month.
create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  kind text not null default 'bill',
  category text not null default 'other',
  amount_paise bigint,
  due_on date not null,
  anchor_day integer,
  repeat text not null default 'monthly',
  remind_days integer not null default 3,
  autopay boolean not null default false,
  notes text,
  active boolean not null default true,
  last_paid_on date,
  last_reminded_on date,
  created_at timestamptz not null default now()
);

alter table bills drop constraint if exists bills_kind_known;
alter table bills add constraint bills_kind_known check (kind in ('bill', 'renewal'));
alter table bills drop constraint if exists bills_repeat_known;
alter table bills
  add constraint bills_repeat_known check (repeat in ('none', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'));
alter table bills drop constraint if exists bills_remind_sane;
alter table bills add constraint bills_remind_sane check (remind_days between 0 and 90);
alter table bills drop constraint if exists bills_amount_sane;
alter table bills
  add constraint bills_amount_sane check (amount_paise is null or (amount_paise > 0 and amount_paise <= 10000000000000));

create index if not exists bills_user_due_idx on bills (user_id, active, due_on);

create table if not exists bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  due_on date not null,
  paid_on date not null,
  amount_paise bigint,
  created_at timestamptz not null default now()
);

create index if not exists bill_payments_bill_idx on bill_payments (bill_id, paid_on);
