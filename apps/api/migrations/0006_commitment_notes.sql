-- Notes used to live only on the visit that produced a follow-up. An
-- appointment added directly ("dentist, bring the old x-rays") has no visit
-- behind it, so it needs somewhere of its own to put them.
alter table commitments
  add column if not exists notes text;
