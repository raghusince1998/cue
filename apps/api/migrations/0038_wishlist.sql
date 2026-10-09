-- The wishlist: things you want to do, with a place or without one.
--
-- A wish was always for a place ("when I go to Jaipur…"). Some are not:
-- "learn swimming", "read Deep Work", "try the new Italian place". Those wait
-- for a plan to attach them to rather than a trip, so the place is optional.
alter table intentions alter column place_label drop not null;
