-- Minimal PostgreSQL compatibility layer for restoring this application's
-- Supabase schema into the isolated standalone database. This is NOT a
-- Supabase Auth replacement; application login/session endpoints are separate.
CREATE SCHEMA IF NOT EXISTS auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT auth_users_email_lowercase CHECK (email IS NULL OR email = lower(email))
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_unique
  ON auth.users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Legacy policies mention these roles. The standalone API will use a separate
-- limited DB role and explicit endpoints; do not grant it BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
