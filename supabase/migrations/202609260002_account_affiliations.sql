-- Explicit account office/service and authoritative request routing.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.account_office(details jsonb, scopes jsonb DEFAULT '{}') RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result text; candidates text[];
BEGIN
 result:=coalesce(nullif(details->>'office',''),nullif(details->>'validationBureau',''));
 IF result IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO') THEN RETURN result; END IF;
 SELECT array_agg(code) INTO candidates FROM (VALUES ('B01','ITC-B01'),('B02','ITC-B02'),('BOUAKE','ITC-BOUAKE'),('SAN-PEDRO','ITC-SAN-PEDRO'),('YAMOUSSOUKRO','ITC-YAMOUSSOUKRO')) m(code,op)
 WHERE scopes->op='true'::jsonb OR coalesce(details->'managedOps','[]') ? op;
 IF cardinality(candidates)=1 THEN RETURN candidates[1]; END IF;
 RETURN NULL;
END $$;

-- One-time, tenant-specific correction requested for the existing ITC technicians.
CREATE SCHEMA IF NOT EXISTS migration_private;
REVOKE ALL ON SCHEMA migration_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS migration_private.account_affiliations_20260926 AS SELECT * FROM app_profiles;
ALTER TABLE migration_private.account_affiliations_20260926 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON migration_private.account_affiliations_20260926 FROM PUBLIC,anon,authenticated;
UPDATE app_profiles SET profile=profile||jsonb_build_object('office','B02','serviceAbbreviation','B2B','affiliationMigrated',true),updated_at=now()
 WHERE company_id='COMP-ITC-LEGACY' AND role='Technicien' AND NOT profile ? 'affiliationMigrated' AND user_id IN (SELECT user_id FROM migration_private.account_affiliations_20260926);
UPDATE app_profiles SET profile=profile||jsonb_build_object('office',account_office(profile,control_scopes)),updated_at=now()
 WHERE role IN ('Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice') AND nullif(profile->>'office','') IS NULL AND account_office(profile,control_scopes) IS NOT NULL;
UPDATE app_profiles SET profile=profile||'{"canChooseInitialService":true}'::jsonb WHERE role IN ('Coordinateur','Coordinatrice') AND nullif(profile->>'serviceAbbreviation','') IS NULL AND NOT profile ? 'canChooseInitialService' AND user_id IN (SELECT user_id FROM migration_private.account_affiliations_20260926);
UPDATE app_records r SET payload=r.payload||jsonb_strip_nulls(jsonb_build_object('office',p.profile->'office','serviceAbbreviation',p.profile->'serviceAbbreviation','affiliationMigrated',p.profile->'affiliationMigrated','canChooseInitialService',p.profile->'canChooseInitialService')),updated_at=now()
 FROM app_profiles p WHERE r.collection='users' AND r.company_id=p.company_id AND r.payload->>'uid'=coalesce(p.firebase_uid,p.user_id::text)
 AND p.role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice');

CREATE OR REPLACE FUNCTION public.set_account_affiliation(actor_id uuid,target_id uuid,office_code text,service_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_profiles; changes jsonb;
BEGIN
 SELECT * INTO actor FROM app_profiles WHERE user_id=actor_id AND is_active;
 SELECT * INTO target FROM app_profiles WHERE user_id=target_id FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND target.company_id<>actor.company_id) THEN RAISE EXCEPTION 'Affectation réservée au responsable de cette entreprise.'; END IF;
 IF target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice') THEN RAISE EXCEPTION 'Ce rôle ne nécessite pas de rattachement.'; END IF;
 IF office_code IS NULL OR office_code NOT IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO') OR service_code IS NULL OR service_code NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Bureau et service obligatoires.'; END IF;
 changes:=jsonb_build_object('office',office_code,'serviceAbbreviation',service_code,'canChooseInitialService',false,'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor.user_id);
 IF target.role IN ('Validateur','Validatrice') THEN changes:=changes||jsonb_build_object('validationBureau',office_code); END IF;
 UPDATE app_profiles SET profile=profile||changes,updated_at=now() WHERE user_id=target_id;
 UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable.'; END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,jsonb_build_object('action','ASSIGN_ACCOUNT_AFFILIATION','company_id',target.company_id,'target',target_id,'by',actor_id,'before',jsonb_build_object('office',target.profile->'office','serviceAbbreviation',target.profile->'serviceAbbreviation'),'after',changes,'date',clock_timestamp()));
END $$;
REVOKE ALL ON FUNCTION public.set_account_affiliation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.assign_account_affiliation(target_uid text,office_code text,service_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 SELECT user_id INTO target FROM app_profiles WHERE coalesce(firebase_uid,user_id::text)=target_uid;
 PERFORM set_account_affiliation(auth.uid(),target,office_code,service_code);
END $$;
REVOKE ALL ON FUNCTION public.assign_account_affiliation(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_account_affiliation(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.choose_initial_coordinator_service(service_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; changes jsonb;
BEGIN
 SELECT * INTO actor FROM app_profiles WHERE user_id=auth.uid() AND is_active FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice') OR actor.profile->'canChooseInitialService' IS DISTINCT FROM 'true'::jsonb OR nullif(actor.profile->>'serviceAbbreviation','') IS NOT NULL THEN RAISE EXCEPTION 'Le responsable doit modifier votre rattachement.'; END IF;
 IF service_code IS NULL OR service_code NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Service invalide.'; END IF;
 changes:=jsonb_build_object('serviceAbbreviation',service_code,'canChooseInitialService',false,'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor.user_id);
 UPDATE app_profiles SET profile=profile||changes,updated_at=now() WHERE user_id=actor.user_id;
 UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=actor.company_id AND payload->>'uid'=coalesce(actor.firebase_uid,actor.user_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable.'; END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','CHOOSE_COORDINATOR_SERVICE','company_id',actor.company_id,'by',actor.user_id,'service',service_code,'date',clock_timestamp()));
END $$;
REVOKE ALL ON FUNCTION public.choose_initial_coordinator_service(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.choose_initial_coordinator_service(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_company_user_affiliated(actor_id uuid,new_user_id uuid,company text,user_role text,user_name text,user_email text,stock_ops text[],office_code text DEFAULT NULL,service_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 result:=register_company_user(actor_id,new_user_id,company,user_role,user_name,user_email,stock_ops);
 IF user_role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice') THEN
  PERFORM set_account_affiliation(actor_id,new_user_id,office_code,service_code);
 END IF;
 SELECT profile-'email' INTO result FROM app_profiles WHERE user_id=new_user_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.register_company_user_affiliated(uuid,uuid,text,text,text,text,text[],text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_company_user_affiliated(uuid,uuid,text,text,text,text,text[],text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.request_origin_office(company text,request jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE origin text;
BEGIN
 IF request->>'originOffice' IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO') THEN RETURN request->>'originOffice'; END IF;
 SELECT account_office(profile,control_scopes) INTO origin FROM app_profiles WHERE company_id=company AND role='Technicien'
 AND (coalesce(firebase_uid,user_id::text)=request->>'technicienUid' OR profile->>'id'=coalesce(request->>'technicienId',request->>'demandeurOriginalId')) LIMIT 1;
 IF origin IS NOT NULL THEN RETURN origin; END IF;
 SELECT account_office(profile,control_scopes) INTO origin FROM app_profiles WHERE company_id=company AND role IN ('Coordinateur','Coordinatrice','Superviseur Terrain') AND profile->>'id'=request->>'coordinateurId' LIMIT 1;
 RETURN origin;
END $$;
CREATE OR REPLACE FUNCTION public.validator_office_covers(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(account_office(details,scopes)=request_origin_office(company,request),false);
$$;

CREATE OR REPLACE FUNCTION public.eligible_request_coordinator(coordinator_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.profile FROM app_profiles p, current_app_profile() actor
 WHERE actor.role='Technicien' AND p.company_id=actor.company_id AND p.is_active AND p.role IN ('Coordinateur','Coordinatrice')
 AND p.profile->>'id'=coordinator_id AND account_office(p.profile,p.control_scopes)=account_office(actor.profile,actor.control_scopes)
 AND p.profile->>'serviceAbbreviation'=actor.profile->>'serviceAbbreviation';
$$;
REVOKE ALL ON FUNCTION public.eligible_request_coordinator(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.eligible_request_coordinator(text) TO authenticated;

-- Freeze known origins for old requests; no service or date is rewritten on old bons.
UPDATE app_records SET payload=payload||jsonb_build_object('originOffice',request_origin_office(company_id,payload)),updated_at=now()
 WHERE collection='demandes' AND NOT payload ? 'originOffice' AND request_origin_office(company_id,payload) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_account_affiliation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor app_profiles; coordinator jsonb; previous jsonb;
BEGIN
 IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 SELECT * INTO actor FROM current_app_profile();
 previous:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
 IF NEW.collection='users' AND (NEW.payload->'office' IS DISTINCT FROM previous->'office' OR NEW.payload->'serviceAbbreviation' IS DISTINCT FROM previous->'serviceAbbreviation' OR NEW.payload->'validationBureau' IS DISTINCT FROM previous->'validationBureau' OR NEW.payload->'canChooseInitialService' IS DISTINCT FROM previous->'canChooseInitialService') THEN RAISE EXCEPTION 'Utilisez le rattachement des comptes.'; END IF;
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.payload->'originOffice' IS DISTINCT FROM previous->'originOffice' OR NEW.payload->'technicienUid' IS DISTINCT FROM previous->'technicienUid' OR NEW.payload->'technicienId' IS DISTINCT FROM previous->'technicienId' OR NEW.payload->'demandeurOriginalId' IS DISTINCT FROM previous->'demandeurOriginalId' OR NEW.payload->'coordinateurId' IS DISTINCT FROM previous->'coordinateurId') THEN RAISE EXCEPTION 'Le bureau et les signataires du bon ne peuvent pas être réaffectés.'; END IF;
 IF TG_OP='INSERT' AND actor.role='Technicien' THEN
  IF account_office(actor.profile,actor.control_scopes) IS NULL OR coalesce(actor.profile->>'serviceAbbreviation','') NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Faites renseigner votre bureau et votre service.'; END IF;
  coordinator:=eligible_request_coordinator(NEW.payload->>'coordinateurId');
  IF coordinator IS NULL OR account_office(coordinator,coalesce(coordinator->'controlScopes','{}')) IS DISTINCT FROM account_office(actor.profile,actor.control_scopes) OR coordinator->>'serviceAbbreviation' IS DISTINCT FROM actor.profile->>'serviceAbbreviation' THEN RAISE EXCEPTION 'Choisissez un coordinateur actif de votre bureau et de votre service.'; END IF;
  NEW.payload:=NEW.payload||jsonb_build_object('originOffice',account_office(actor.profile,actor.control_scopes),'serviceAbbreviation',actor.profile->>'serviceAbbreviation','technicienUid',coalesce(actor.firebase_uid,actor.user_id::text),'technicienId',actor.profile->'id','demandeurOriginalId',actor.profile->'id','coordinateurNom',coordinator->'name','emetteur',coordinator->'name');
 ELSIF TG_OP='INSERT' AND actor.role IN ('Coordinateur','Coordinatrice','Superviseur Terrain','Superviseur') THEN
  IF actor.role IN ('Coordinateur','Coordinatrice') AND (account_office(actor.profile,actor.control_scopes) IS NULL OR nullif(actor.profile->>'serviceAbbreviation','') IS NULL) THEN RAISE EXCEPTION 'Renseignez votre bureau et votre service avant de créer un bon.'; END IF;
  IF account_office(actor.profile,actor.control_scopes) IS NOT NULL THEN NEW.payload:=NEW.payload||jsonb_build_object('originOffice',account_office(actor.profile,actor.control_scopes)); ELSE NEW.payload:=NEW.payload-'originOffice'; END IF;
  IF actor.role IN ('Coordinateur','Coordinatrice') THEN NEW.payload:=NEW.payload||jsonb_build_object('serviceAbbreviation',actor.profile->>'serviceAbbreviation'); END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aa_guard_account_affiliation ON app_records;
CREATE TRIGGER aa_guard_account_affiliation BEFORE INSERT OR UPDATE ON app_records FOR EACH ROW EXECUTE FUNCTION guard_account_affiliation();

-- The routing checks below are replaced from their current definitions to retain
-- all decision, correction, expiry and stock-transaction protections.
DO $$
DECLARE name text; definition text;
BEGIN
 FOREACH name IN ARRAY ARRAY['decide_stock_request(text,boolean,uuid,text)','confirm_bon_renewal(text,jsonb,boolean,text)'] LOOP
  SELECT pg_get_functiondef(to_regprocedure('public.'||name)) INTO definition;
  IF definition IS NULL THEN RAISE EXCEPTION 'Migration préalable manquante : %',name; END IF;
  definition:=replace(definition,'validator_covers_request(actor.control_scopes,request.payload)','validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,request.payload)');
  EXECUTE definition;
 END LOOP;
 SELECT pg_get_functiondef('public.notify_stock_workflow()'::regprocedure) INTO definition;
 definition:=replace(definition,'validator_covers_request(control_scopes,NEW.payload)','validator_office_covers(profile,control_scopes,company_id,NEW.payload)');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.request_bon_renewal(text)'::regprocedure) INTO definition;
 definition:=replace(definition,'validator_covers_request(control_scopes,request.payload)','validator_office_covers(profile,control_scopes,company_id,request.payload)');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
