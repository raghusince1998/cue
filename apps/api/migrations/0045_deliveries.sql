-- Deliveries, from the messages shops and couriers send. Each later message
-- about the same parcel — recognised by its order or tracking number, or by
-- shop and item — moves it along instead of adding another.
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  store text,
  item text,
  status text not null default 'shipped',
  expected_on date,
  cod_paise bigint,
  order_ref text,
  tracking_url text,
  last_reminded_on date,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table deliveries drop constraint if exists deliveries_status_known;
alter table deliveries
  add constraint deliveries_status_known
  check (status in ('ordered', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'));

create index if not exists deliveries_user_status_idx on deliveries (user_id, status);
