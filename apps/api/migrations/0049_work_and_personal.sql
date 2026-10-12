-- Work and personal on one day.
--
-- Which half of life a plan belongs to is worked out from its words when it
-- is read (packages/shared/src/sphere.ts). These columns hold only what the
-- person decided themselves, which always wins. A repeat's choice is copied
-- to each of its days.
alter table commitments add column if not exists sphere text;
alter table commitments drop constraint if exists commitments_sphere_known;
alter table commitments add constraint commitments_sphere_known check (sphere is null or sphere in ('work', 'personal'));

alter table recurrences add column if not exists sphere text;
alter table recurrences drop constraint if exists recurrences_sphere_known;
alter table recurrences add constraint recurrences_sphere_known check (sphere is null or sphere in ('work', 'personal'));

-- The working week, in the person's own zone. Outside it, work's reminders
-- that only nag wait for the morning; inside it, personal ones wait for the
-- evening. A time someone chose themselves is always kept.
alter table users add column if not exists keep_apart boolean not null default true;
alter table users add column if not exists work_days integer[] not null default '{1,2,3,4,5}';
alter table users add column if not exists work_start_hour integer not null default 9;
alter table users add column if not exists work_end_hour integer not null default 18;
alter table users drop constraint if exists users_work_hours_sane;
alter table users add constraint users_work_hours_sane check (
  work_start_hour between 0 and 23 and work_end_hour between 1 and 24 and work_start_hour < work_end_hour
);
