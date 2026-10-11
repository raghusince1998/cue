-- What someone uses Cue for: a job hunt, hiring, a household, sales, office
-- work, a business, studies. It decides what the screens lead with; it turns
-- nothing off. Empty until they say, and then everything is shown.
alter table users add column if not exists uses text[] not null default '{}';
