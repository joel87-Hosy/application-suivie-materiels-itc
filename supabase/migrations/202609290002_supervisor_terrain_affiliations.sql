-- Give field supervisors the same multi-office/service assignment controls and
-- enforce those assignments on their material requests.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.set_account_affiliations(actor_id uuid,target_id uuid,office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_profiles; changes jsonb; chosen text;
BEGIN
 SELECT * INTO actor FROM app_profiles WHERE user_id=actor_id AND is_active;
 SELECT * INTO target FROM app_profiles WHERE user_id=target_id FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND actor.company_id<>target.company_id) THEN RAISE EXCEPTION 'Affectation réservée au responsable de cette entreprise.'; END IF;
 IF target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain') THEN RAISE EXCEPTION 'Ce rôle ne nécessite pas de rattachement.'; END IF;
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

CREATE OR REPLACE FUNCTION public.register_company_user_multi(actor_id uuid,new_user_id uuid,company text,user_role text,user_name text,user_email text,stock_ops text[],office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 result:=register_company_user(actor_id,new_user_id,company,user_role,user_name,user_email,stock_ops);
 IF user_role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain') THEN
  PERFORM set_account_affiliations(actor_id,new_user_id,office_codes,service_codes,coordinator_ids,validator_ids);
 END IF;
 SELECT profile-'email' INTO result FROM app_profiles WHERE user_id=new_user_id;
 RETURN result;
END $$;

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
  ELSE NEW.payload:=NEW.payload||jsonb_build_object('coordinateurId',actor.profile->'id'); END IF;
 ELSIF TG_OP='INSERT' AND actor.role='Superviseur Terrain' THEN
  office_code:=coalesce(nullif(NEW.payload->>'originOffice',''),account_office(actor.profile,actor.control_scopes));
  service_code:=NEW.payload->>'serviceAbbreviation';
  IF NOT account_offices(actor.profile,actor.control_scopes) ? coalesce(office_code,'') OR NOT account_services(actor.profile) ? coalesce(service_code,'') THEN RAISE EXCEPTION 'Choisissez un bureau et un service affectés à votre compte.'; END IF;
  NEW.payload:=NEW.payload||jsonb_build_object('originOffice',office_code,'serviceAbbreviation',service_code,'coordinateurId',actor.profile->'id');
 ELSIF TG_OP='INSERT' AND actor.role IN ('Superviseur','SUPER_ADMIN') THEN
  NEW.payload:=NEW.payload-'originOffice';
  IF account_office(actor.profile,actor.control_scopes) IS NOT NULL THEN NEW.payload:=NEW.payload||jsonb_build_object('originOffice',account_office(actor.profile,actor.control_scopes)); END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assign_supervisor_terrain_validators() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; allowed text[]; eligible text[];
BEGIN
 IF TG_OP<>'INSERT' OR NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role<>'Superviseur Terrain' THEN RETURN NEW; END IF;
 SELECT coalesce(array_agg(value),'{}'::text[]) INTO allowed
 FROM jsonb_array_elements_text(coalesce(actor.profile->'allowedValidatorIds','[]'::jsonb));
 IF cardinality(allowed)=0 THEN RETURN NEW; END IF;
 SELECT coalesce(array_agg(p.profile->>'id'),'{}'::text[]) INTO eligible
 FROM app_profiles p
 WHERE p.company_id=actor.company_id AND p.is_active AND p.role IN ('Validateur','Validatrice')
  AND p.profile->>'id'=ANY(allowed)
  AND account_offices(p.profile,p.control_scopes) ? NEW.payload->>'originOffice';
 IF cardinality(eligible)=0 THEN RAISE EXCEPTION 'Aucun validateur autorisé pour ce bureau. Contactez le responsable.'; END IF;
 NEW.payload:=NEW.payload||jsonb_build_object('eligibleValidatorIds',to_jsonb(eligible));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bb_assign_supervisor_terrain_validators ON public.app_records;
CREATE TRIGGER bb_assign_supervisor_terrain_validators BEFORE INSERT ON public.app_records
FOR EACH ROW EXECUTE FUNCTION public.assign_supervisor_terrain_validators();

REVOKE ALL ON FUNCTION public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assign_supervisor_terrain_validators() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_account_affiliations(text,text[],text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
