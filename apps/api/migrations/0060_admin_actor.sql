-- The admin portal signs in with its own credentials, not a Cue account, so
-- the trail names the admin by the email they signed in with.
alter table audit_events add column if not exists actor text;
