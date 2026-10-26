-- Deals (and the other boards) say why they closed — "price too high", "went
-- with a competitor" — so won and lost can each be looked back on; and when a
-- deal is expected to close, so the pipeline has dates as well as values.
alter table tracker_items add column if not exists close_reason text;
alter table tracker_items add column if not exists expected_close_on date;
