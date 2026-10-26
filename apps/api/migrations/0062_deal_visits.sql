-- Where a deal is — the clinic, the shop, the office — as a saved place, so
-- the next visit has directions, and the place shows in Places and nearby
-- reminders like any other.
alter table tracker_items add column if not exists place_id uuid references places(id) on delete set null;

-- Visits and calls logged on a deal (or an application, or a candidate). They
-- are the same visits and calls as everywhere else — the person's history, the
-- day's report and targets count them — linked to what they were about.
alter table interactions add column if not exists tracker_item_id uuid references tracker_items(id) on delete set null;
create index if not exists interactions_tracker_item_idx on interactions (tracker_item_id, started_at) where tracker_item_id is not null;
