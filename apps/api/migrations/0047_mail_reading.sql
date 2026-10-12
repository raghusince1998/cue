-- Reading email, read-only, for what Cue can act on: bookings, parcels,
-- card statements and utility bills. Asked for separately from the calendar,
-- and only ever looked at in messages from the senders that send these.
-- Nothing of a message is kept but its id — to know it has been read — and
-- what was found in it.
alter table oauth_states add column if not exists purpose text not null default 'calendar';

alter table oauth_accounts add column if not exists mail_enabled boolean not null default false;
alter table oauth_accounts add column if not exists mail_checked_at timestamptz;
alter table oauth_accounts add column if not exists mail_error text;

create table if not exists mail_seen (
  account_id uuid not null references oauth_accounts(id) on delete cascade,
  message_id text not null,
  -- What it became, in words, for the "found in your email" list: null when nothing.
  found text,
  seen_at timestamptz not null default now(),
  primary key (account_id, message_id)
);

create index if not exists mail_seen_found_idx on mail_seen (account_id, seen_at desc) where found is not null;
