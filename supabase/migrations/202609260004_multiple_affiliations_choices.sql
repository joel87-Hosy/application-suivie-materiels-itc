BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Existing bons must run UPDATE guards only: an upsert runs INSERT guards first,
-- which rejects their saved server dates and recalculates immutable routing.
CREATE OR REPLACE FUNCTION public.save_app_changes(changes jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE change jsonb; previous jsonb; existed boolean;
BEGIN
 FOR change IN SELECT value FROM jsonb_array_elements(changes) ORDER BY value->>'collection',value->>'record_key' LOOP
  SELECT payload INTO previous FROM app_records WHERE collection=change->>'collection' AND record_key=change->>'record_key' FOR UPDATE;
  existed:=FOUND;
  IF previous IS DISTINCT FROM nullif(change->'previous','null'::jsonb) THEN RAISE EXCEPTION 'Données modifiées par un autre utilisateur. Actualisez puis réessayez.'; END IF;
  IF existed THEN
   UPDATE app_records SET payload=change->'payload',updated_at=now() WHERE collection=change->>'collection' AND record_key=change->>'record_key';
  ELSE
   INSERT INTO app_records(collection,record_key,company_id,payload,updated_at) VALUES(change->>'collection',change->>'record_key',change->>'company_id',change->'payload',now());
  END IF;
 END LOOP;
END $$;

-- Always return an array, including for historical profiles.
CREATE OR REPLACE FUNCTION public.account_offices(details jsonb,scopes jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN jsonb_typeof(details->'offices')='array' AND jsonb_array_length(details->'offices')>0 THEN details->'offices'
 WHEN account_office(details,scopes) IS NOT NULL THEN jsonb_build_array(account_office(details,scopes)) ELSE '[]'::jsonb END;
$$;
CREATE OR REPLACE FUNCTION public.account_services(details jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN jsonb_typeof(details->'services')='array' AND jsonb_array_length(details->'services')>0 THEN details->'services'
 WHEN nullif(details->>'serviceAbbreviation','') IS NOT NULL THEN jsonb_build_array(details->>'serviceAbbreviation') ELSE '[]'::jsonb END;
$$;

CREATE OR REPLACE FUNCTION public.set_account_affiliations(actor_id uuid,target_id uuid,office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_profiles; changes jsonb; chosen text;
BEGIN
 SELECT * INTO actor FROM app_profiles WHERE user_id=actor_id AND is_active;
 SELECT * INTO target FROM app_profiles WHERE user_id=target_id FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND actor.company_id<>target.company_id) THEN RAISE EXCEPTION 'Affectation réservée au responsable de cette entreprise.'; END IF;
 IF target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice') THEN RAISE EXCEPTION 'Ce rôle ne nécessite pas de rattachement.'; END IF;
 IF coalesce(cardinality(office_codes),0)=0 OR cardinality(office_codes)>5 OR EXISTS(SELECT 1 FROM unnest(office_codes) x WHERE x IS NULL OR x NOT IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO')) OR coalesce(cardinality(service_codes),0)=0 OR cardinality(service_codes)>3 OR EXISTS(SELECT 1 FROM unnest(service_codes) x WHERE x IS NULL OR x NOT IN ('B2B','DEP','MAIN')) THEN RAISE EXCEPTION 'Bureaux et services obligatoires et valides.'; END IF;
 IF coordinator_ids IS NULL OR validator_ids IS NULL OR cardinality(coordinator_ids)>100 OR cardinality(validator_ids)>100 THEN RAISE EXCEPTION 'Liste de correspondants invalide.'; END IF;
 FOREACH chosen IN ARRAY coordinator_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM app_profiles WHERE company_id=target.company_id AND is_active AND role IN ('Coordinateur','Coordinatrice') AND profile->>'id'=chosen AND account_offices(profile,control_scopes) ?| office_codes AND account_services(profile) ?| service_codes) THEN RAISE EXCEPTION 'Coordinateur actif de la même entreprise, bureau et service requis.'; END IF;
 END LOOP;
 FOREACH chosen IN ARRAY validator_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM app_profiles WHERE company_id=target.company_id AND is_active AND role IN ('Validateur','Validatrice') AND profile->>'id'=chosen AND account_offices(profile,control_scopes) ?| office_codes) THEN RAISE EXCEPTION 'Validateur actif de la même entreprise et du bureau requis.'; END IF;
 END LOOP;
 changes:=jsonb_build_object('office',office_codes[1],'offices',to_jsonb(office_codes),'serviceAbbreviation',service_codes[1],'services',to_jsonb(service_codes),'allowedCoordinatorIds',to_jsonb(coordinator_ids),'allowedValidatorIds',to_jsonb(validator_ids),'canChooseInitialService',false,'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor_id);
 IF target.role IN ('Validateur','Validatrice') THEN changes:=changes||jsonb_build_object('validationBureau',office_codes[1]); END IF;
 UPDATE app_profiles SET profile=profile||changes,updated_at=now() WHERE user_id=target_id;
 UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable.'; END IF;
 INSERT INTO app_records VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,jsonb_build_object('action','ASSIGN_ACCOUNT_AFFILIATIONS','company_id',target.company_id,'target',target_id,'by',actor_id,'before',target.profile,'after',changes,'date',clock_timestamp()),now());
END $$;
REVOKE ALL ON FUNCTION public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.assign_account_affiliations(target_uid text,office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 SELECT user_id INTO target FROM app_profiles WHERE coalesce(firebase_uid,user_id::text)=target_uid;
 PERFORM set_account_affiliations(auth.uid(),target,office_codes,service_codes,coordinator_ids,validator_ids);
END $$;
REVOKE ALL ON FUNCTION public.assign_account_affiliations(text,text[],text[],text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_account_affiliations(text,text[],text[],text[],text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_account_affiliation(actor_id uuid,target_id uuid,office_code text,service_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM set_account_affiliations(actor_id,target_id,ARRAY[office_code],ARRAY[service_code],ARRAY[]::text[],ARRAY[]::text[]);
END $$;

CREATE OR REPLACE FUNCTION public.register_company_user_multi(actor_id uuid,new_user_id uuid,company text,user_role text,user_name text,user_email text,stock_ops text[],office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 result:=register_company_user(actor_id,new_user_id,company,user_role,user_name,user_email,stock_ops);
 IF user_role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice') THEN
  PERFORM set_account_affiliations(actor_id,new_user_id,office_codes,service_codes,coordinator_ids,validator_ids);
 END IF;
 SELECT profile-'email' INTO result FROM app_profiles WHERE user_id=new_user_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.eligible_request_coordinator(coordinator_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.profile FROM app_profiles p,current_app_profile() actor
 WHERE actor.role='Technicien' AND p.company_id=actor.company_id AND p.is_active AND p.role IN ('Coordinateur','Coordinatrice') AND p.profile->>'id'=coordinator_id
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(account_offices(actor.profile,actor.control_scopes)) o WHERE account_offices(p.profile,p.control_scopes) ? o)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(account_services(actor.profile)) s WHERE account_services(p.profile) ? s)
 AND (coalesce(actor.profile->'allowedCoordinatorIds','[]')='[]'::jsonb OR actor.profile->'allowedCoordinatorIds' ? coordinator_id);
$$;

CREATE OR REPLACE FUNCTION public.guard_account_affiliation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor app_profiles; coordinator jsonb; previous jsonb; office_code text; service_code text;
BEGIN
 IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 SELECT * INTO actor FROM current_app_profile();
 previous:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
 IF NEW.collection='users' AND EXISTS(SELECT 1 FROM unnest(ARRAY['office','serviceAbbreviation','validationBureau','canChooseInitialService','offices','services','allowedCoordinatorIds','allowedValidatorIds']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k) THEN RAISE EXCEPTION 'Utilisez le rattachement des comptes.'; END IF;
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM unnest(ARRAY['originOffice','technicienUid','technicienId','demandeurOriginalId','coordinateurId']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k) THEN RAISE EXCEPTION 'Le bureau et les signataires du bon ne peuvent pas être réaffectés.'; END IF;
 IF TG_OP='INSERT' AND actor.role IN ('Technicien','Coordinateur','Coordinatrice') THEN
  office_code:=coalesce(nullif(NEW.payload->>'originOffice',''),account_office(actor.profile,actor.control_scopes));
  service_code:=coalesce(nullif(NEW.payload->>'serviceAbbreviation',''),actor.profile->>'serviceAbbreviation');
  IF NOT account_offices(actor.profile,actor.control_scopes) ? coalesce(office_code,'') OR NOT account_services(actor.profile) ? coalesce(service_code,'') THEN RAISE EXCEPTION 'Choisissez un bureau et un service affectés à votre compte.'; END IF;
  NEW.payload:=NEW.payload||jsonb_build_object('originOffice',office_code,'serviceAbbreviation',service_code);
  IF actor.role='Technicien' THEN
   coordinator:=eligible_request_coordinator(NEW.payload->>'coordinateurId');
   IF coordinator IS NULL OR NOT account_offices(coordinator,coalesce(coordinator->'controlScopes','{}')) ? office_code OR NOT account_services(coordinator) ? service_code THEN RAISE EXCEPTION 'Choisissez un coordinateur actif de votre bureau et de votre service.'; END IF;
   NEW.payload:=NEW.payload||jsonb_build_object('technicienUid',coalesce(actor.firebase_uid,actor.user_id::text),'technicienId',actor.profile->'id','demandeurOriginalId',actor.profile->'id','coordinateurNom',coordinator->'name','emetteur',coordinator->'name');
  ELSE NEW.payload:=NEW.payload||jsonb_build_object('coordinateurId',actor.profile->'id');
  END IF;
 ELSIF TG_OP='INSERT' AND actor.role IN ('Superviseur Terrain','Superviseur') THEN
  NEW.payload:=NEW.payload-'originOffice';
  IF account_office(actor.profile,actor.control_scopes) IS NOT NULL THEN NEW.payload:=NEW.payload||jsonb_build_object('originOffice',account_office(actor.profile,actor.control_scopes)); END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.special_coordinator(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM app_profiles p JOIN auth.users u ON u.id=p.user_id
 WHERE p.user_id=target AND p.is_active AND p.company_id='COMP-ITC-LEGACY' AND p.role IN ('Coordinateur','Coordinatrice') AND lower(trim(u.email))='moovmaintenance@ivoiretechnocom.ci');
$$;
REVOKE ALL ON FUNCTION public.special_coordinator(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.special_coordinator(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.workflow_request_choices() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; validators jsonb; managers jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF NOT special_coordinator(actor.user_id) THEN RETURN jsonb_build_object('enabled',false); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('uid',user_id,'id',profile->'id','name',profile->>'name','offices',account_offices(profile,control_scopes))),'[]') INTO validators
 FROM app_profiles WHERE company_id=actor.company_id AND is_active AND role IN ('Validateur','Validatrice') AND account_offices(profile,control_scopes) ?| ARRAY['B01','B02'];
 SELECT coalesce(jsonb_agg(jsonb_build_object('uid',user_id,'id',profile->'id','name',profile->>'name','scopes',control_scopes)),'[]') INTO managers FROM app_profiles WHERE company_id=actor.company_id AND is_active AND role='Gestionnaire';
 RETURN jsonb_build_object('enabled',true,'validators',validators,'managers',managers);
END $$;
REVOKE ALL ON FUNCTION public.workflow_request_choices() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workflow_request_choices() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_request_validation_office() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; previous jsonb; selected app_profiles; manager app_profiles; item jsonb; changed boolean; coordinator jsonb; special_owner boolean; technician jsonb; eligible jsonb;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 previous:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
 SELECT * INTO actor FROM current_app_profile();
 changed:=EXISTS(SELECT 1 FROM unnest(ARRAY['requestedValidatorUid','requestedValidationOffice','requestedManagerUid']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k);
 IF TG_OP='UPDATE' AND NOT changed AND EXISTS(SELECT 1 FROM unnest(ARRAY['validationOffice','selectedValidatorId','selectedValidatorName','requestedManagerName','eligibleValidatorIds']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k) THEN RAISE EXCEPTION 'Le circuit de validation du bon est protégé.'; END IF;
 IF changed OR (special_coordinator(actor.user_id) AND (TG_OP='INSERT' OR (previous->>'status'='EN ATTENTE COORDINATION' AND NEW.payload->>'status' IN ('EN ATTENTE VALIDATEUR','EN ATTENTE GESTIONNAIRE')))) THEN
  IF NOT special_coordinator(actor.user_id) OR actor.company_id IS DISTINCT FROM NEW.company_id OR NEW.payload->>'coordinateurId' IS DISTINCT FROM actor.profile->>'id'
   OR (TG_OP='UPDATE' AND (previous->>'status' IS DISTINCT FROM 'EN ATTENTE COORDINATION' OR NEW.payload->>'status' NOT IN ('EN ATTENTE COORDINATION','EN ATTENTE VALIDATEUR','EN ATTENTE GESTIONNAIRE'))) THEN RAISE EXCEPTION 'Choix du circuit réservé au coordinateur spécial avant transmission.'; END IF;
  SELECT * INTO selected FROM app_profiles WHERE user_id::text=NEW.payload->>'requestedValidatorUid' AND company_id=actor.company_id AND is_active AND role IN ('Validateur','Validatrice');
  IF selected.user_id IS NULL OR coalesce(NEW.payload->>'requestedValidationOffice','') NOT IN ('B01','B02') OR NOT account_offices(selected.profile,selected.control_scopes) ? (NEW.payload->>'requestedValidationOffice') THEN RAISE EXCEPTION 'Choisissez un validateur actif du bureau 01 ou 02.'; END IF;
  SELECT * INTO manager FROM app_profiles WHERE user_id::text=NEW.payload->>'requestedManagerUid' AND company_id=actor.company_id AND is_active AND role='Gestionnaire';
  IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Choisissez un gestionnaire actif.'; END IF;
  IF jsonb_typeof(NEW.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'items') LOOP
   IF manager.control_scopes->workflow_op(coalesce(item->>'op',NEW.payload->>'op')) IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Le gestionnaire choisi ne gère pas tous les stocks demandés.'; END IF;
  END LOOP;
  NEW.payload:=NEW.payload||jsonb_build_object('validationOffice',NEW.payload->>'requestedValidationOffice','selectedValidatorId',selected.profile->>'id','selectedValidatorName',selected.profile->>'name','requestedManagerName',manager.profile->>'name','eligibleValidatorIds',jsonb_build_array(selected.profile->>'id'));
 ELSIF TG_OP='INSERT' THEN
  NEW.payload:=NEW.payload-ARRAY['validationOffice','selectedValidatorId','selectedValidatorName','requestedManagerName','eligibleValidatorIds'];
  NEW.payload:=NEW.payload||jsonb_strip_nulls(jsonb_build_object('validationOffice',initial_request_validation_office(NEW.company_id,NEW.payload)));
  SELECT profile,special_coordinator(user_id) INTO coordinator,special_owner FROM app_profiles WHERE company_id=NEW.company_id AND role IN ('Coordinateur','Coordinatrice') AND profile->>'id'=NEW.payload->>'coordinateurId';
  SELECT profile INTO technician FROM app_profiles WHERE company_id=NEW.company_id AND role='Technicien' AND coalesce(firebase_uid,user_id::text)=NEW.payload->>'technicienUid';
  IF special_owner IS NOT TRUE AND (coalesce(coordinator->'allowedValidatorIds','[]')<>'[]'::jsonb OR coalesce(technician->'allowedValidatorIds','[]')<>'[]'::jsonb) THEN
   SELECT coalesce(jsonb_agg(p.profile->>'id'),'[]') INTO eligible FROM app_profiles p
   WHERE p.company_id=NEW.company_id AND p.is_active AND p.role IN ('Validateur','Validatrice') AND account_offices(p.profile,p.control_scopes) ? (NEW.payload->>'validationOffice')
   AND (coalesce(coordinator->'allowedValidatorIds','[]')='[]'::jsonb OR coordinator->'allowedValidatorIds' ? (p.profile->>'id'))
   AND (coalesce(technician->'allowedValidatorIds','[]')='[]'::jsonb OR technician->'allowedValidatorIds' ? (p.profile->>'id'));
   IF eligible='[]'::jsonb THEN RAISE EXCEPTION 'Aucun validateur commun autorisé pour ce bureau. Contactez le responsable.'; END IF;
   NEW.payload:=NEW.payload||jsonb_build_object('eligibleValidatorIds',eligible);
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.validator_office_covers(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(account_offices(details,scopes) ? coalesce(nullif(request->>'validationOffice',''),request_origin_office(company,request))
 AND (NOT request ? 'eligibleValidatorIds' OR request->'eligibleValidatorIds' ? (details->>'id'))
 AND (NOT request ? 'selectedValidatorId' OR request->>'selectedValidatorId'=details->>'id'),false);
$$;

DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.decide_stock_request(text,boolean,uuid,text)'::regprocedure) INTO definition;
 IF position('Le gestionnaire choisi par le coordinateur doit être conservé.' IN definition)=0 THEN
  definition:=replace(definition,'IF approve IS NULL THEN',E'IF request.payload ? ''requestedManagerUid'' AND request.payload->>''requestedManagerUid'' IS DISTINCT FROM manager_uid::text THEN RAISE EXCEPTION ''Le gestionnaire choisi par le coordinateur doit être conservé.''; END IF;\n IF approve IS NULL THEN');
  EXECUTE definition;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
