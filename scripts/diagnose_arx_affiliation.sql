-- Read-only. Run in the Supabase SQL editor as the project administrator.
-- No passwords, access tokens, role changes or account activation.
WITH auth_account AS (
 SELECT id,email FROM auth.users WHERE lower(trim(email))='arx-group@itc.ci'
), profiles AS (
 SELECT p.user_id,p.firebase_uid,p.company_id,p.role,p.profile->>'id' AS application_id
 FROM public.app_profiles p JOIN auth_account a ON a.id=p.user_id
), records AS (
 SELECT r.record_key,r.company_id,r.payload->>'id' AS application_id,r.payload->>'uid' AS stored_uid,
 r.payload->>'email' AS email,r.payload->>'role' AS role,
 public.affiliation_record_identity(r.company_id,r.record_key,r.payload) AS resolution
 FROM public.app_records r WHERE r.collection='users' AND (
  lower(trim(r.payload->>'email'))='arx-group@itc.ci'
  OR EXISTS(SELECT 1 FROM profiles p WHERE p.company_id=r.company_id AND (
   r.payload->>'uid'=p.user_id::text OR r.payload->>'uid'=p.firebase_uid OR r.record_key=p.user_id::text
   OR r.payload->>'id'=p.application_id))
 )
)
SELECT (SELECT count(*) FROM auth_account) AS auth_accounts,
 (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM profiles p) AS application_profiles,
 (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM records r) AS user_records;
