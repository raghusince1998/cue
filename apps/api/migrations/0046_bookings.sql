-- A booking — a train, a flight, a hotel, a show — kept as a plan with what
-- the confirmation said: the reference to show, where it goes, the seat. A
-- plan with a booking is reminded ahead of time and never chased afterwards:
-- once the train has left, it has left.
alter table commitments add column if not exists booking jsonb;
