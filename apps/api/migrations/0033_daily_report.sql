-- The daily report: the day's meetings, visits and what got done, written up
-- for whoever you report to.
--
-- report_to_* is that person: a name to greet them by, and where it goes.
-- report_enabled is an evening reminder to send it, off by default — plenty
-- of people report to nobody, and a nightly prompt to do so would be noise.
alter table users
  add column if not exists report_enabled boolean not null default false,
  add column if not exists report_hour integer not null default 18,
  add column if not exists last_report_prompt_on date,
  add column if not exists report_to_name text,
  add column if not exists report_to_email text,
  add column if not exists report_to_phone text;

alter table users drop constraint if exists users_report_hour_sane;
alter table users
  add constraint users_report_hour_sane check (report_hour between 0 and 23);
