-- The admin portal: what happened to accounts (sign-ins, password changes,
-- connections, devices, admin actions), kept for 90 days for security. Who
-- did it, from where (address and browser), and how it went — never what
-- anyone wrote.
create table if not exists audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  -- The account it happened to. Kept null rather than deleted with the
  -- account, so an abuse trail survives the account it came from.
  user_id uuid references users(id) on delete set null,
  -- An admin acting on someone else's account; null when it was their own.
  actor_id uuid references users(id) on delete set null,
  -- The address typed at a sign-in, for failures against no account.
  email text,
  action text not null,
  outcome text not null default 'ok',
  ip text,
  user_agent text,
  detail jsonb
);
create index if not exists audit_events_at_idx on audit_events (at desc);
create index if not exists audit_events_user_idx on audit_events (user_id, at desc);
create index if not exists audit_events_action_idx on audit_events (action, at desc);

-- Turned off by an admin: no sign-in, and tokens already out stop working.
alter table users add column if not exists disabled_at timestamptz;
alter table users add column if not exists disabled_reason text;
-- "Sign out everywhere": tokens issued before this are refused.
alter table users add column if not exists sessions_from timestamptz;
-- Last time the app was used, to the nearest few minutes.
alter table users add column if not exists last_seen_at timestamptz;
