-- Quick messages: what you send over and over, written once.
--
-- Per person rather than per org: how someone signs off, and what they say
-- to a clinic after a demo, is theirs. uses and last_used_at put the ones
-- actually sent first.
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text not null,
  uses integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists message_templates_user_idx on message_templates (user_id);
