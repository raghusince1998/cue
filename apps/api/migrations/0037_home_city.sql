-- Where this person lives, so "meeting in Pune" is a trip for someone in
-- Mumbai and an ordinary day for someone in Pune. Set the first time they say
-- "Pune is where I live"; until then any city counts as away.
alter table users add column if not exists home_city text;
