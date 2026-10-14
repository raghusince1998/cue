-- After the exam and on the day. A score worked out from the answer key,
-- by round. And the exam day as the admit card gave it — reporting time,
-- gate, start and end — kept as data, to say it to family in one tap.
alter table exams add column if not exists expected_scores jsonb not null default '{}'::jsonb;
alter table exams add column if not exists exam_day jsonb;
