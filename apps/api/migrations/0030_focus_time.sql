-- Focus time: a block of protected time.
--
-- A focus block is a commitment of kind 'focus' (kind is free text, so no
-- change there). While one is under way, routine reminders are held until it
-- ends; this marks the ones being held, so ending early can release them and
-- Today can say how many are waiting.
alter table reminders
  add column if not exists held boolean not null default false;
