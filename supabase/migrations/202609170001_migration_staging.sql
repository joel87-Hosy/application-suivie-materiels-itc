-- Private, append-only landing area. This does not switch the application backend.
-- No business data or authentication exports are exposed through the public API.
CREATE SCHEMA IF NOT EXISTS migration_private;
REVOKE ALL ON SCHEMA migration_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS migration_private.firebase_snapshots (
  id text PRIMARY KEY,
  exported_at timestamptz NOT NULL,
  source_project text NOT NULL,
  database_sha256 text NOT NULL CHECK (length(database_sha256) = 64),
  auth_sha256 text NOT NULL CHECK (length(auth_sha256) = 64),
  database_data jsonb NOT NULL,
  auth_accounts jsonb NOT NULL CHECK (jsonb_typeof(auth_accounts) = 'array'),
  manifest jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_private.firebase_documents (
  snapshot_id text NOT NULL REFERENCES migration_private.firebase_snapshots(id),
  source_path text NOT NULL,
  company_id text,
  payload jsonb NOT NULL,
  PRIMARY KEY(snapshot_id, source_path)
);
CREATE INDEX IF NOT EXISTS firebase_documents_company_idx
ON migration_private.firebase_documents(snapshot_id, company_id);

-- Firebase UIDs are not UUIDs. Preserve them until Supabase Auth mappings have
-- been established and all dependent references have been checked.
CREATE TABLE IF NOT EXISTS migration_private.auth_identity_map (
  firebase_uid text PRIMARY KEY,
  supabase_uid uuid UNIQUE,
  company_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified')),
  verified_at timestamptz,
  CHECK (status <> 'verified' OR (supabase_uid IS NOT NULL AND verified_at IS NOT NULL))
);

ALTER TABLE migration_private.firebase_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_private.firebase_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_private.auth_identity_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA migration_private FROM PUBLIC;
-- No client policies: only the migration administrator may access these tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA migration_private FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA migration_private FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA migration_private FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA migration_private FROM authenticated;
  END IF;
END $$;
