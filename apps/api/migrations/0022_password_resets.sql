-- Getting back in after forgetting a password.
--
-- Only a hash of the token is kept. The token itself exists in exactly two
-- places — the email, and the link the person clicks — and never in this table,
-- so a copy of the database is not a stack of working password resets.
create table if not exists password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- sha256 of the token. Unique so a collision cannot silently reset the wrong
  -- account, though at 256 bits that is theatre rather than a real worry.
  token_hash text not null unique,
  -- An hour. Long enough to find the mail, short enough that a link sitting in
  -- an inbox for a week is not a standing key to the account.
  expires_at timestamptz not null,
  -- Set on use. The row is kept rather than deleted so a second click says
  -- "already used" instead of the same message as a forged token — those are
  -- different problems and deserve different answers.
  used_at timestamptz,
  -- Recorded only to make abuse visible in logs. Never shown to anyone.
  requested_ip text,
  created_at timestamptz not null default now()
);

create index if not exists password_resets_user_idx on password_resets (user_id, created_at desc);
create index if not exists password_resets_expiry_idx on password_resets (expires_at);
