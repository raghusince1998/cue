-- Bring-your-own-key: each org points at its own provider and pays its own
-- bill, so offering the feature costs the operator nothing.
--
-- The key is stored encrypted, never in plain text. It belongs to the customer
-- and a database dump should not hand it over.
alter table orgs
  add column if not exists ai_provider text not null default 'none',
  add column if not exists ai_api_key_encrypted text,
  add column if not exists ai_model text,
  -- Only used by the self-hosted provider (Ollama).
  add column if not exists ai_endpoint text;
