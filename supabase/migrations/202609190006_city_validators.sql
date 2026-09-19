BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA IF NOT EXISTS migration_private;
REVOKE ALL ON SCHEMA migration_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS migration_private.city_validators_profiles_20260919 AS
 SELECT p.* FROM app_profiles p JOIN auth.users u ON p.user_id=u.id
 WHERE lower(u.email) IN ('nguessanpierre@ivoiretechnocom.ci','diakiteaboubakar@ivoiretechnocom.ci');
CREATE TABLE IF NOT EXISTS migration_private.city_validators_users_20260919 AS
 SELECT * FROM app_records WHERE collection='users' AND lower(payload->>'email') IN ('nguessanpierre@ivoiretechnocom.ci','diakiteaboubakar@ivoiretechnocom.ci');
REVOKE ALL ON migration_private.city_validators_profiles_20260919,migration_private.city_validators_users_20260919 FROM PUBLIC,anon,authenticated;
DO $$
DECLARE account text; target app_profiles; scopes jsonb; keys jsonb; changes jsonb; affected integer;
BEGIN
 FOREACH account IN ARRAY ARRAY['nguessanpierre@ivoiretechnocom.ci','diakiteaboubakar@ivoiretechnocom.ci'] LOOP
  SELECT p.* INTO target FROM app_profiles p JOIN auth.users u ON u.id=p.user_id WHERE lower(u.email)=account AND p.role IN ('Validateur','Validatrice') AND p.is_active AND p.company_id='COMP-ITC-LEGACY' FOR UPDATE OF p;
  IF target.user_id IS NULL THEN RAISE EXCEPTION 'Validateur attendu introuvable : %',account; END IF;
  scopes:=target.control_scopes||'{"ITC-BOUAKE":true,"ITC-SAN-PEDRO":true,"ITC-YAMOUSSOUKRO":true}'::jsonb;
  SELECT jsonb_object_agg(target.company_id||'|'||key,true) INTO keys FROM jsonb_each(scopes) WHERE value='true'::jsonb;
  changes:=jsonb_build_object('controlScopes',scopes,'controlScopeKeys',keys);
  UPDATE app_profiles SET control_scopes=scopes,control_scope_keys=keys,profile=profile||changes,updated_at=now() WHERE user_id=target.user_id;
  UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Fiche validateur absente ou ambiguë : %',account; END IF;
 END LOOP;
END $$;
INSERT INTO cable_offcut_stores(company_id,op)
SELECT 'COMP-ITC-LEGACY',op FROM unnest(ARRAY['ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO']) op
ON CONFLICT(company_id,op) DO NOTHING;
COMMIT;
