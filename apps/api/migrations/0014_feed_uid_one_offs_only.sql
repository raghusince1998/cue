-- The (feed_id, external_uid) uniqueness was too broad.
--
-- It exists to stop a re-read of the same feed duplicating a one-off event.
-- But every generated occurrence of an imported *repeating* event carries the
-- series' UID too, so all seventeen Tuesdays collided on one key and the
-- insert's ON CONFLICT DO NOTHING silently kept only the first. The series
-- looked imported and had exactly one date.
--
-- Occurrences already have their own uniqueness — (recurrence_id,
-- occurrence_on) — so this one only needs to cover rows that are not part of a
-- series.
drop index if exists commitments_feed_uid_unique;

create unique index if not exists commitments_feed_uid_unique
  on commitments (feed_id, external_uid)
  where feed_id is not null and recurrence_id is null;
