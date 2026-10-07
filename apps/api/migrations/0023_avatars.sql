-- A face on the account.
--
-- Stored in the database rather than on the instance's disk, following the
-- same reasoning as voice notes: a deploy replaces the application directory
-- and an instance can be relaunched entirely, which would quietly take every
-- uploaded file with it. RDS is backed up and outlives both.
--
-- Avatars are small by the time they arrive — the browser resizes and
-- re-encodes before upload — so this is kilobytes per user, not megabytes.
alter table users
  add column if not exists avatar bytea,
  add column if not exists avatar_mime text,
  -- Doubles as the cache-busting key: the URL carries it, so a new photo is a
  -- new URL and no browser shows the old one.
  add column if not exists avatar_updated_at timestamptz;
