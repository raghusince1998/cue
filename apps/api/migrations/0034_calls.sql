-- Calls, logged the moment you hang up.
--
-- A call is an interaction like a visit, so it lives in the same table and
-- counts in the same places — a person's history, an account's last contact,
-- the daily report. channel tells them apart. connected is whether you
-- actually spoke: an unanswered call is worth recording (you tried) but is not
-- contact, and must not reset anyone's keep-in-touch clock.
alter table interactions
  add column if not exists channel text not null default 'visit',
  add column if not exists connected boolean not null default true;

alter table interactions drop constraint if exists interactions_channel_known;
alter table interactions
  add constraint interactions_channel_known check (channel in ('visit', 'call'));

create index if not exists interactions_contact_idx
  on interactions (contact_id, started_at desc)
  where contact_id is not null;
