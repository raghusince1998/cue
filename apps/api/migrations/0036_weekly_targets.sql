-- Weekly targets: how many calls, visits, meetings and so on you mean to get
-- through in a week. Counted from what is already logged; only the goals are
-- stored. A JSON object of metric to number ({"calls": 40, "visits": 10}),
-- because the set of metrics will grow and each is one number.
alter table users
  add column if not exists weekly_targets jsonb not null default '{}'::jsonb;
