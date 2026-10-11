-- Trackers: job applications, candidates, deals — anything that moves
-- through stages until it is done. The title is who it is about (the company
-- applied to, the candidate, the client); the detail is what (the role, the
-- deal). Each stage change is kept, so an item can show how it got here.
create table if not exists tracker_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  board text not null,
  title text not null,
  detail text,
  stage text not null,
  contact_id uuid references contacts(id) on delete set null,
  value_paise bigint,
  link text,
  notes text,
  stage_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table tracker_items drop constraint if exists tracker_items_board_known;
alter table tracker_items
  add constraint tracker_items_board_known check (board in ('jobs', 'hiring', 'deals'));
alter table tracker_items drop constraint if exists tracker_items_value_sane;
alter table tracker_items
  add constraint tracker_items_value_sane check (value_paise is null or (value_paise >= 0 and value_paise <= 100000000000000));

create index if not exists tracker_items_user_board_idx on tracker_items (user_id, board);

create table if not exists tracker_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references tracker_items(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  at timestamptz not null default now()
);

create index if not exists tracker_events_item_idx on tracker_events (item_id, at);

-- A plan can be the next step of a tracked item: "second interview, friday".
alter table commitments add column if not exists tracker_item_id uuid references tracker_items(id) on delete set null;
create index if not exists commitments_tracker_item_idx on commitments (tracker_item_id) where tracker_item_id is not null;
