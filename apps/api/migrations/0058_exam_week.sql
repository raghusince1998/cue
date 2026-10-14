-- The Sunday prep report: for whoever tracks an exam, once a week, and can
-- be turned off. The day it last went, so a restart cannot send it twice.
alter table users add column if not exists exam_week_enabled boolean not null default true;
alter table users add column if not exists last_exam_week_on date;
-- The yearly 1 April reminder to get a new category certificate (EWS, OBC,
-- MBC), kept so it is set once and found again; a series under Repeating.
alter table users add column if not exists certificate_series_id uuid references recurrences(id) on delete set null;
