-- One connected-account table instead of one per provider.
--
-- Google arrived first and took the whole shape with it: google_accounts,
-- google_account_id, google_calendar_id. Adding Microsoft that way would mean a
-- second table, a second near-identical token service and a second set of
-- routes — three copies of the same OAuth round trip, drifting apart the first
-- time one of them is fixed.
--
-- Nothing has connected yet, so the rename costs nothing today and saves that
-- duplication for every provider after this one. Postgres carries the foreign
-- keys and the data across a rename, so there is nothing to migrate.
alter table google_accounts rename to oauth_accounts;

-- Which service this account is with. Defaulted for the rows that cannot exist
-- yet, then the default is dropped: every future row states its provider.
alter table oauth_accounts add column if not exists provider text not null default 'google';
alter table oauth_accounts alter column provider drop default;

alter index if exists google_accounts_user_idx rename to oauth_accounts_user_idx;
drop index if exists google_accounts_user_email_idx;

-- The same address can exist at two providers and they are different accounts.
create unique index if not exists oauth_accounts_user_provider_email_idx
  on oauth_accounts (user_id, provider, email);

-- A feed's link to its account stops being Google-shaped too.
alter table calendar_feeds rename column google_account_id to oauth_account_id;
alter table calendar_feeds rename column google_calendar_id to external_calendar_id;

drop index if exists calendar_feeds_google_idx;
create unique index if not exists calendar_feeds_external_idx
  on calendar_feeds (oauth_account_id, external_calendar_id)
  where external_calendar_id is not null;
