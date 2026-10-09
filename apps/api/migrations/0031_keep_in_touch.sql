-- Where someone works, and how often you mean to hear from them.
--
-- organization is free text ("ABC Physio Clinic", "Infosys") rather than a
-- saved place: a saved place needs a visit with GPS on, and most people you
-- deal with you have never visited.
--
-- keep_in_touch_days is the gap you are happy to leave between contacts. When
-- nothing has happened with someone yet, the clock starts from
-- keep_in_touch_since, the moment the rhythm was set, so choosing "monthly" is
-- not instantly overdue. last_contacted_at is "Talked today", for the calls
-- and chats that never become a plan in Cue; meetings, visits and finished
-- calls count on their own. touch_snoozed_until is "remind me next week".
alter table contacts
  add column if not exists organization text,
  add column if not exists keep_in_touch_days integer,
  add column if not exists keep_in_touch_since timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists touch_snoozed_until timestamptz;

alter table contacts drop constraint if exists contacts_keep_in_touch_days_sane;
alter table contacts
  add constraint contacts_keep_in_touch_days_sane
  check (keep_in_touch_days is null or keep_in_touch_days between 1 and 366);

create index if not exists contacts_keep_in_touch_idx
  on contacts (org_id)
  where keep_in_touch_days is not null;
