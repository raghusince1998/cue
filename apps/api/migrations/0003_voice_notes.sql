-- Audio is stored in Postgres rather than on disk. A 30-second opus clip is
-- ~40 KB, so even ten thousand notes is well under a gigabyte, and this way the
-- app needs no persistent volume and voice notes are covered by the same backup
-- as everything else. If it ever outgrows that, the swap is to put an object
-- store behind the same two endpoints.
create table if not exists voice_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- Null while recording, set when the visit it belongs to is saved.
  interaction_id uuid references interactions(id) on delete cascade,
  mime_type text not null,
  duration_ms integer,
  size_bytes integer not null,
  audio bytea not null,
  -- Filled in only if the user chose browser dictation; audio works without it.
  transcript text,
  created_at timestamptz not null default now()
);

create index if not exists voice_notes_interaction_idx on voice_notes (interaction_id);
-- Supports sweeping up clips recorded for a visit that was never saved.
create index if not exists voice_notes_orphan_idx on voice_notes (created_at)
  where interaction_id is null;
