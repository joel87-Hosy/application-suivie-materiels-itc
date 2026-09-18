-- Ensure every verified Supabase identity has an application profile.
-- Existing active profiles are preserved; only missing/incomplete profiles are repaired.
WITH latest AS (
  SELECT id
  FROM migration_private.firebase_snapshots
  ORDER BY imported_at DESC
  LIMIT 1
), source_profiles AS (
  SELECT
    map.supabase_uid,
    map.firebase_uid,
    COALESCE(
      NULLIF(profile.payload->>'company_id', ''),
      NULLIF(user_record.payload->>'company_id', ''),
      map.company_id
    ) AS company_id,
    COALESCE(profile.payload->>'role', user_record.payload->>'role') AS role,
    COALESCE(profile.payload, user_record.payload, '{}'::jsonb) AS payload,
    COALESCE(profile.payload->'controlScopes', '{}'::jsonb) AS control_scopes,
    COALESCE(profile.payload->'controlScopeKeys', '{}'::jsonb) AS control_scope_keys
  FROM migration_private.auth_identity_map AS map
  CROSS JOIN latest
  LEFT JOIN migration_private.firebase_documents AS profile
    ON profile.snapshot_id = latest.id
   AND profile.source_path = 'auth_profiles/' || map.firebase_uid
  LEFT JOIN migration_private.firebase_documents AS user_record
    ON user_record.snapshot_id = latest.id
   AND user_record.source_path LIKE 'itc_data/users/%'
   AND user_record.payload->>'uid' = map.firebase_uid
  WHERE map.status = 'verified'
    AND map.supabase_uid IS NOT NULL
), repairable AS (
  SELECT *
  FROM source_profiles
  WHERE company_id IS NOT NULL
    AND role IS NOT NULL
)
INSERT INTO public.app_profiles (
  user_id,
  firebase_uid,
  company_id,
  role,
  is_active,
  control_scopes,
  control_scope_keys,
  profile
)
SELECT
  supabase_uid,
  firebase_uid,
  company_id,
  role,
  COALESCE((payload->>'is_active')::boolean, true),
  control_scopes,
  control_scope_keys,
  payload
FROM repairable
ON CONFLICT (user_id) DO UPDATE SET
  firebase_uid = EXCLUDED.firebase_uid,
  company_id = EXCLUDED.company_id,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  control_scopes = CASE
    WHEN public.app_profiles.control_scopes = '{}'::jsonb THEN EXCLUDED.control_scopes
    ELSE public.app_profiles.control_scopes
  END,
  control_scope_keys = CASE
    WHEN public.app_profiles.control_scope_keys = '{}'::jsonb THEN EXCLUDED.control_scope_keys
    ELSE public.app_profiles.control_scope_keys
  END,
  profile = CASE
    WHEN public.app_profiles.profile = '{}'::jsonb THEN EXCLUDED.profile
    ELSE public.app_profiles.profile
  END,
  updated_at = now();

-- Report verified identities still lacking enough source data for repair.
SELECT
  map.firebase_uid,
  map.supabase_uid,
  map.company_id,
  map.status
FROM migration_private.auth_identity_map AS map
LEFT JOIN public.app_profiles AS profile
  ON profile.user_id = map.supabase_uid
WHERE map.status = 'verified'
  AND map.supabase_uid IS NOT NULL
  AND profile.user_id IS NULL
ORDER BY map.firebase_uid;
