-- The weekly review: the week behind, and the one ahead, every Friday.
alter table users
  add column if not exists weekly_review_enabled boolean not null default true,
  -- Local hour on Friday, 0-23.
  add column if not exists weekly_review_hour integer not null default 17,
  -- Local date of the last Friday prompt, so a restart cannot send two.
  add column if not exists last_review_prompt_on date,
  -- When the person last finished a review.
  add column if not exists last_reviewed_at timestamptz;
