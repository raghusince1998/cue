-- Connecting Google Calendar properly, instead of asking for a secret URL.
--
-- The existing feed machinery works, but getting a calendar into it meant
-- finding the "secret address in iCal format" buried in Google's settings —
-- and on a managed Workspace account that option is often switched off
-- entirely, which is exactly where this fell over. OAuth asks the person
-- instead of asking them to go hunting.

-- One connected Google account. Several calendars can hang off it, so the
-- tokens live here rather than being copied onto every feed row — a refresh
-- rotates one row, not five.
create table if not exists google_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- Which account this is, so two of them can be told apart on screen.
  email text not null,
  -- Both encrypted with the same key as every other stored credential. A
  -- refresh token is a standing grant to read someone's calendar; it is not
  -- kept in plain text any more than a password would be.
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  -- What was actually granted. Google may hand back less than was asked for,
  -- and finding that out at request time is too late to explain it.
  scope text,
  status text not null default 'active',
  last_error text,
  created_at timestamptz not null default now()
);

-- Reconnecting the same account updates it rather than piling up duplicates.
create unique index if not exists google_accounts_user_email_idx
  on google_accounts (user_id, email);

-- The in-flight half of an OAuth round trip.
--
-- The callback arrives as a plain browser redirect from Google with no auth
-- header, so the state parameter is the only thing tying it back to whoever
-- started it. Server-side and single-use: a state that can be guessed, reused
-- or replayed is how an attacker attaches *their* calendar to someone else's
-- account. The verifier is the PKCE half, which stops an intercepted code
-- being redeemed by anyone but us.
create table if not exists oauth_states (
  state text primary key,
  provider text not null default 'google',
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz not null default now(),
  -- Minutes, not hours. A consent screen left open overnight is not a session
  -- worth resuming.
  expires_at timestamptz not null
);

create index if not exists oauth_states_expiry_idx on oauth_states (expires_at);

-- A feed can now come from a connected account instead of a URL or a file.
-- Cascading: disconnecting the account takes its calendars with it, and the
-- existing feed_id cascade takes the mirrored commitments. Leaving orphaned
-- events behind that nothing can refresh would be worse than removing them.
alter table calendar_feeds
  add column if not exists google_account_id uuid references google_accounts(id) on delete cascade,
  add column if not exists google_calendar_id text;

-- The same calendar twice would mirror every event twice.
create unique index if not exists calendar_feeds_google_idx
  on calendar_feeds (google_account_id, google_calendar_id)
  where google_calendar_id is not null;
