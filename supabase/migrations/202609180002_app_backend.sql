-- Supabase application backend. Run after 202609170001_migration_staging.sql.
-- The JSON payload preserves the existing Firebase document shape while the
-- frontend is migrated incrementally.
CREATE TABLE IF NOT EXISTS public.app_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  firebase_uid text UNIQUE,
  company_id text NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  control_scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  control_scope_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_records (
  collection text NOT NULL,
  record_key text NOT NULL,
  company_id text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, record_key)
);
CREATE INDEX IF NOT EXISTS app_records_company_idx
  ON public.app_records (company_id, collection);

CREATE TABLE IF NOT EXISTS public.app_settings (
  company_id text NOT NULL,
  setting_key text NOT NULL,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, setting_key)
);

ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_app_profile()
RETURNS public.app_profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p FROM public.app_profiles p WHERE p.user_id = auth.uid() AND p.is_active;
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'SUPER_ADMIN' FROM public.app_profiles WHERE user_id = auth.uid() AND is_active), false);
$$;

DROP POLICY IF EXISTS app_profiles_self ON public.app_profiles;
CREATE POLICY app_profiles_self ON public.app_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_app_admin());

DROP POLICY IF EXISTS app_records_tenant_read ON public.app_records;
CREATE POLICY app_records_tenant_read ON public.app_records
  FOR SELECT TO authenticated
  USING (public.is_app_admin() OR company_id = (public.current_app_profile()).company_id);

DROP POLICY IF EXISTS app_records_tenant_write ON public.app_records;
CREATE POLICY app_records_tenant_write ON public.app_records
  FOR ALL TO authenticated
  USING (public.is_app_admin() OR company_id = (public.current_app_profile()).company_id)
  WITH CHECK (public.is_app_admin() OR company_id = (public.current_app_profile()).company_id);

DROP POLICY IF EXISTS app_settings_tenant ON public.app_settings;
CREATE POLICY app_settings_tenant ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_app_admin() OR company_id = (public.current_app_profile()).company_id)
  WITH CHECK (public.is_app_admin() OR company_id = (public.current_app_profile()).company_id);

DO $$
DECLARE
  latest_snapshot_id text;
BEGIN
  SELECT id INTO latest_snapshot_id
  FROM migration_private.firebase_snapshots
  ORDER BY imported_at DESC
  LIMIT 1;
  IF latest_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'Aucun snapshot Firebase disponible';
  END IF;

  INSERT INTO public.app_profiles (user_id, firebase_uid, company_id, role, is_active, control_scopes, control_scope_keys, profile)
  SELECT
    map.supabase_uid,
    map.firebase_uid,
    COALESCE(profile.payload->>'company_id', map.company_id),
    profile.payload->>'role',
    COALESCE((profile.payload->>'is_active')::boolean, true),
    COALESCE(profile.payload->'controlScopes', '{}'::jsonb),
    COALESCE(profile.payload->'controlScopeKeys', '{}'::jsonb),
    profile.payload
  FROM migration_private.auth_identity_map map
  JOIN migration_private.firebase_documents profile
    ON profile.snapshot_id = latest_snapshot_id
   AND profile.source_path = 'auth_profiles/' || map.firebase_uid
  WHERE map.status = 'verified'
    AND map.supabase_uid IS NOT NULL
    AND profile.payload->>'role' IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET
    firebase_uid = EXCLUDED.firebase_uid,
    company_id = EXCLUDED.company_id,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    control_scopes = EXCLUDED.control_scopes,
    control_scope_keys = EXCLUDED.control_scope_keys,
    profile = EXCLUDED.profile,
    updated_at = now();

  INSERT INTO public.app_records (collection, record_key, company_id, payload)
  SELECT
    split_part(source_path, '/', 2),
    split_part(source_path, '/', 3),
    company_id,
    payload
  FROM migration_private.firebase_documents
  WHERE snapshot_id = latest_snapshot_id
    AND source_path LIKE 'itc_data/%/%'
  ON CONFLICT (collection, record_key) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    payload = EXCLUDED.payload,
    updated_at = now();

  INSERT INTO public.app_settings (company_id, setting_key, value)
  SELECT split_part(settings_doc.source_path, '/', 2), setting.key, setting.value
  FROM migration_private.firebase_documents
  AS settings_doc
  CROSS JOIN LATERAL jsonb_each(settings_doc.payload) AS setting
  WHERE settings_doc.snapshot_id = latest_snapshot_id
    AND settings_doc.source_path LIKE 'tenant_settings/%'
  ON CONFLICT (company_id, setting_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_profiles, public.app_records, public.app_settings TO authenticated;