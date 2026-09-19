-- Assign each validator to its office and to the dedicated stocks of that office.
-- Create the accounts in Supabase Authentication first; a missing account aborts the migration.
-- Requires 202609190001_validator_bureaus.sql (validator_covers_request).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Keep a private copy of the profiles and user records before the first assignment.
CREATE TABLE IF NOT EXISTS migration_private.validator_bureaus_profiles_20260919 AS
 SELECT p.* FROM public.app_profiles p JOIN auth.users u ON u.id=p.user_id
 WHERE lower(u.email) IN ('wandjadeslande@ivoiretechnocom.ci','nguessanpierre@ivoiretechnocom.ci','diakiteaboubakar@ivoiretechnocom.ci');
CREATE TABLE IF NOT EXISTS migration_private.validator_bureaus_users_20260919 AS
 SELECT * FROM public.app_records WHERE collection='users' AND lower(payload->>'email') IN ('wandjadeslande@ivoiretechnocom.ci','nguessanpierre@ivoiretechnocom.ci','diakiteaboubakar@ivoiretechnocom.ci');
REVOKE ALL ON migration_private.validator_bureaus_profiles_20260919,migration_private.validator_bureaus_users_20260919 FROM PUBLIC,anon,authenticated;

-- Each validator inherits the exact stock perimeter of the gestionnaire of its office.
DO $$
DECLARE mapping record; target public.app_profiles; manager public.app_profiles; changes jsonb; keys jsonb; affected integer;
BEGIN
 FOR mapping IN SELECT * FROM (VALUES
 ('wandjadeslande@ivoiretechnocom.ci','gest@itc.ci','B01'),
 ('nguessanpierre@ivoiretechnocom.ci','gest_b02@itc.ci','B02'),
 ('diakiteaboubakar@ivoiretechnocom.ci','gest_b02@itc.ci','B02')) AS assignments(email,manager_email,bureau) LOOP
   SELECT p.* INTO target FROM public.app_profiles p JOIN auth.users u ON u.id=p.user_id WHERE lower(u.email)=mapping.email AND p.role IN ('Validateur','Validatrice') AND p.is_active FOR UPDATE OF p;
   SELECT p.* INTO manager FROM public.app_profiles p JOIN auth.users u ON u.id=p.user_id WHERE lower(u.email)=mapping.manager_email AND p.role='Gestionnaire' AND p.is_active;
   IF target.user_id IS NULL OR manager.user_id IS NULL OR target.company_id IS DISTINCT FROM manager.company_id OR manager.company_id<>'COMP-ITC-LEGACY' THEN RAISE EXCEPTION 'Compte ou périmètre inattendu pour %',mapping.email; END IF;
   IF coalesce(manager.control_scopes->('ITC-'||mapping.bureau),'false')<>'true'::jsonb THEN RAISE EXCEPTION 'Gestionnaire non affecté au bureau attendu'; END IF;
   SELECT jsonb_object_agg(manager.company_id||'|'||key,true) INTO keys FROM jsonb_each(manager.control_scopes) WHERE value='true'::jsonb;
   changes:=jsonb_build_object('validationBureau',mapping.bureau,'controlScopes',manager.control_scopes,'controlScopeKeys',keys);
   UPDATE public.app_profiles SET control_scopes=manager.control_scopes,control_scope_keys=keys,profile=profile||changes,updated_at=now() WHERE user_id=target.user_id;
   UPDATE public.app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>1 THEN RAISE EXCEPTION 'Fiche utilisateur absente ou ambiguë pour %',mapping.email; END IF;
   -- Backfill the inbox notifications of the bons already waiting for this office.
   INSERT INTO public.app_records(collection,record_key,company_id,payload)
   SELECT 'notifications','validator-bureau-'||target.user_id::text||'-'||r.record_key,target.company_id,
     jsonb_build_object('id',gen_random_uuid()::text,'company_id',target.company_id,'userId',target.profile->'id','message','BON À VALIDER — '||mapping.bureau||' : '||coalesce(r.payload->>'ref',r.payload->>'id'),'date',now(),'createdAt',now(),'lu',false)
   FROM public.app_records r WHERE r.collection='demandes' AND r.company_id=target.company_id AND r.payload->>'status'='EN ATTENTE VALIDATEUR' AND public.validator_covers_request(manager.control_scopes,r.payload)
   ON CONFLICT(collection,record_key) DO NOTHING;
 END LOOP;
END $$;

COMMIT;
