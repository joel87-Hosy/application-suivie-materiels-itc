-- Keep the coordinator's account office; route this account's bons to B02.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.initial_request_validation_office(company text, request jsonb) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_profiles p JOIN auth.users u ON u.id=p.user_id
  WHERE p.company_id=company AND p.company_id='COMP-ITC-LEGACY'
   AND p.role IN ('Coordinateur','Coordinatrice')
   AND p.profile->>'id'=request->>'coordinateurId'
   AND lower(trim(u.email))='moovmaintenance@ivoiretechnocom.ci'
 ) THEN 'B02' ELSE request_origin_office(company,request) END;
$$;
REVOKE ALL ON FUNCTION public.initial_request_validation_office(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.initial_request_validation_office(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_request_validation_office() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor app_profiles;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.payload->'validationOffice' IS DISTINCT FROM OLD.payload->'validationOffice' THEN
   RAISE EXCEPTION 'Le bureau de validation du bon ne peut pas être réaffecté.';
  END IF;
 ELSE
  IF current_user IN ('authenticated','anon') THEN
   SELECT * INTO actor FROM current_app_profile();
   IF actor.role IN ('Coordinateur','Coordinatrice') THEN
    NEW.payload:=NEW.payload||jsonb_build_object('coordinateurId',actor.profile->'id');
   END IF;
  END IF;
  NEW.payload:=NEW.payload-'validationOffice';
  NEW.payload:=NEW.payload||jsonb_strip_nulls(jsonb_build_object('validationOffice',initial_request_validation_office(NEW.company_id,NEW.payload)));
 END IF;
 RETURN NEW;
END $$;

-- Existing undecided requests follow the exception too. Preserve decided bons.
DROP TRIGGER IF EXISTS ab_guard_request_validation_office ON app_records;
WITH rerouted AS (
 UPDATE app_records SET payload=payload||jsonb_build_object('validationOffice','B02'),updated_at=now()
 WHERE collection='demandes' AND company_id='COMP-ITC-LEGACY'
 AND payload->>'status' IN ('EN ATTENTE COORDINATION','EN ATTENTE VALIDATEUR')
 AND NOT payload ? 'validatorDecision'
 AND initial_request_validation_office(company_id,payload)='B02'
 AND request_origin_office(company_id,payload) IS DISTINCT FROM 'B02'
 AND payload->>'validationOffice' IS DISTINCT FROM 'B02'
 RETURNING company_id,payload
)
INSERT INTO app_records(collection,record_key,company_id,payload)
 SELECT 'notifications',gen_random_uuid()::text,r.company_id,
 jsonb_build_object('id',gen_random_uuid()::text,'company_id',r.company_id,'userId',p.profile->'id',
 'message','BON À VALIDER : '||coalesce(r.payload->>'ref',r.payload->>'id'),'section','validation-bons','date',now(),'createdAt',now(),'lu',false)
 FROM rerouted r JOIN app_profiles p ON p.company_id=r.company_id AND p.is_active
 AND p.role IN ('Validateur','Validatrice') AND account_office(p.profile,p.control_scopes)='B02'
 WHERE r.payload->>'status'='EN ATTENTE VALIDATEUR';

CREATE TRIGGER ab_guard_request_validation_office BEFORE INSERT OR UPDATE ON app_records
 FOR EACH ROW EXECUTE FUNCTION guard_request_validation_office();

CREATE OR REPLACE FUNCTION public.validator_office_covers(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(account_office(details,scopes)=coalesce(nullif(request->>'validationOffice',''),request_origin_office(company,request)),false);
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
