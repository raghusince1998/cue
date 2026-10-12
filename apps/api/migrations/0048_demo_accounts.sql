-- A demo: an account made with one tap from the website, filled with a
-- sample week and removed a day later. Marked so it is never mistaken for a
-- real one, and so a real account can never be swept up with them.
alter table users add column if not exists is_demo boolean not null default false;
create index if not exists users_demo_idx on users (created_at) where is_demo;
