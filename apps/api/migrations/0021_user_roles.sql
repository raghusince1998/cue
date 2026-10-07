-- Who may change settings that affect the whole account.
--
-- The AI provider, its endpoint and its API key live on the org, not the
-- person — one key, billed to whoever owns it, used by everyone in the org. So
-- "pick a model" and "paste a key" were on the same Settings page as "what time
-- is my evening", which is a question only the admin should be answering. In a
-- production deployment that is somebody else's credential and somebody else's
-- bill.
create type user_role as enum ('owner', 'member');

alter table users add column if not exists role user_role not null default 'member';

-- Registering creates the org, so whoever did that owns it. For rows that
-- predate this column, the earliest account in each org is that person.
update users u
   set role = 'owner'
  from (
    select distinct on (org_id) id
      from users
     order by org_id, created_at asc, id asc
  ) first
 where u.id = first.id;

create index if not exists users_org_role_idx on users (org_id, role);
