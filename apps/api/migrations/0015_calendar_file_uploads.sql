-- Importing a calendar from an uploaded .ics file, not only from a URL.
--
-- Needed because the secret iCal address is not always available: a Google
-- Workspace admin can disable external sharing, which removes it entirely, and
-- calendars you do not own never had one. Exporting a file is the path that
-- always works, and it is the same events either way — only how they arrive
-- differs, so this reuses the whole feed pipeline rather than growing a
-- parallel one.
alter table calendar_feeds
  -- 'url' re-reads on a timer; 'file' only changes when a new file is uploaded.
  add column if not exists source text not null default 'url',
  -- What the uploaded file was called, so one upload can be told from another.
  add column if not exists file_name text;

-- A file-sourced feed has no address to store.
alter table calendar_feeds
  alter column url_encrypted drop not null,
  alter column url_hint drop not null;

alter table calendar_feeds
  drop constraint if exists calendar_feeds_url_when_url_source;
alter table calendar_feeds
  add constraint calendar_feeds_url_when_url_source
  check (source <> 'url' or url_encrypted is not null);
