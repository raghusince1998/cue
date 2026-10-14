-- What an aspirant has studied, said once: so the forms open now that fit
-- them come first, and a form opening can be told to those it fits. A level
-- and any training (ITI, engineering, teacher training) — never a date of
-- birth. And whether to be told when a form opens at all.
alter table users add column if not exists exam_level text;
alter table users add column if not exists exam_training text[] not null default '{}';
alter table users add column if not exists exam_form_alerts boolean not null default true;
