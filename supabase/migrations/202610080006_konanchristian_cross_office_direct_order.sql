-- Enable the named B01 coordinator to submit direct orders through B01 or B02.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.special_coordinator(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_profiles p JOIN auth.users u ON u.id=p.user_id
 WHERE p.user_id=target AND p.is_active AND p.company_id='COMP-ITC-LEGACY' AND p.role IN ('Coordinateur','Coordinatrice') AND lower(trim(u.email)) IN ('moovmaintenance@ivoiretechnocom.ci','konanchristian@ivoiretechnocom.ci'));
$$;

CREATE OR REPLACE FUNCTION public.set_account_affiliations(
  actor_id uuid,target_id uuid,office_codes text[],service_codes text[],
  coordinator_ids text[],validator_ids text[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; target public.app_profiles; changes jsonb; chosen text;
BEGIN
 SELECT * INTO actor FROM public.app_profiles WHERE user_id=actor_id AND is_active;
 SELECT * INTO target FROM public.app_profiles WHERE user_id=target_id FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND actor.company_id<>target.company_id) THEN RAISE EXCEPTION 'Affectation rÃ©servÃ©e au responsable de cette entreprise.'; END IF;
 IF target.role='Magasinier' THEN
  IF coalesce(cardinality(office_codes),0)<1 OR cardinality(office_codes)>3 OR EXISTS(SELECT 1 FROM unnest(office_codes) x WHERE x IS NULL OR x NOT IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO')) OR cardinality(ARRAY(SELECT DISTINCT x FROM unnest(office_codes) x))<>cardinality(office_codes) THEN RAISE EXCEPTION 'Attribuez un Ã  trois bureaux distincts au magasinier.'; END IF;
  changes:=jsonb_build_object('office',office_codes[1],'offices',to_jsonb(office_codes),'validationBureau',office_codes[1],
    'serviceAbbreviation',NULL,'services','[]'::jsonb,'allowedCoordinatorIds','[]'::jsonb,'allowedValidatorIds','[]'::jsonb,
    'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor_id);
 ELSE
  IF target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain') THEN RAISE EXCEPTION 'Ce rÃ´le ne nÃ©cessite pas de rattachement.'; END IF;
  IF coalesce(cardinality(office_codes),0)=0 OR cardinality(office_codes)>5 OR EXISTS(SELECT 1 FROM unnest(office_codes) x WHERE x IS NULL OR x NOT IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO')) OR coalesce(cardinality(service_codes),0)=0 OR cardinality(service_codes)>(CASE WHEN target.profile->>'crossOfficeDirectOrder'='true' THEN 11 ELSE 3 END) OR EXISTS(SELECT 1 FROM unnest(service_codes) x WHERE x IS NULL OR x NOT IN ('B2B','DEP','MAIN','PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA')) THEN RAISE EXCEPTION 'Bureaux et services obligatoires et valides.'; END IF;
  IF target.profile->>'crossOfficeDirectOrder'='true' AND (NOT (office_codes @> ARRAY['B01','B02']::text[] AND cardinality(office_codes)=2) OR EXISTS(SELECT 1 FROM unnest(service_codes) s WHERE s NOT IN ('MBM','MFTTH','CIDATA','B2B','DEP','MAIN'))) THEN RAISE EXCEPTION 'Pour ce compte, affectez les bureaux 01 et 02 et des services compatibles.'; END IF;
  IF coordinator_ids IS NULL OR validator_ids IS NULL OR cardinality(coordinator_ids)>100 OR cardinality(validator_ids)>100 THEN RAISE EXCEPTION 'Liste de correspondants invalide.'; END IF;
  FOREACH chosen IN ARRAY coordinator_ids LOOP
   IF NOT EXISTS(SELECT 1 FROM public.app_profiles WHERE company_id=target.company_id AND is_active AND role IN ('Coordinateur','Coordinatrice') AND profile->>'id'=chosen AND public.account_offices(profile,control_scopes) ?| office_codes AND public.account_services(profile) ?| service_codes) THEN RAISE EXCEPTION 'Coordinateur actif de la mÃªme entreprise, bureau et service requis.'; END IF;
  END LOOP;
  FOREACH chosen IN ARRAY validator_ids LOOP
   IF NOT EXISTS(SELECT 1 FROM public.app_profiles WHERE company_id=target.company_id AND is_active AND role IN ('Validateur','Validatrice') AND profile->>'id'=chosen AND public.account_offices(profile,control_scopes) ?| office_codes) THEN RAISE EXCEPTION 'Validateur actif de la mÃªme entreprise et du bureau requis.'; END IF;
  END LOOP;
  changes:=jsonb_build_object('office',office_codes[1],'offices',to_jsonb(office_codes),'serviceAbbreviation',service_codes[1],'services',to_jsonb(service_codes),'allowedCoordinatorIds',to_jsonb(coordinator_ids),'allowedValidatorIds',to_jsonb(validator_ids),'canChooseInitialService',false,'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor_id);
  IF target.role IN ('Validateur','Validatrice') THEN changes:=changes||jsonb_build_object('validationBureau',office_codes[1]); END IF;
 END IF;
 UPDATE public.app_profiles SET profile=profile||changes,updated_at=now() WHERE user_id=target_id;
 UPDATE public.app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable.'; END IF;
 IF target.role='Magasinier' THEN
  UPDATE public.app_records d SET payload=d.payload||jsonb_build_object('assignedMagasinierUid',target_id,'assignedMagasinierName',target.profile->>'name'),updated_at=now()
   WHERE d.collection='demandes' AND d.company_id=target.company_id
    AND d.payload->>'status' IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI')
    AND d.payload->>'managerSignedAt' IS NOT NULL
    AND nullif(d.payload->>'assignedMagasinierUid','') IS NULL
    AND to_jsonb(office_codes) ? public.storekeeper_request_office(d.company_id,d.payload)
    AND (SELECT count(*) FROM public.app_profiles p WHERE p.company_id=target.company_id AND p.is_active AND p.role='Magasinier'
      AND public.storekeeper_has_office(p.profile,p.control_scopes,public.storekeeper_request_office(d.company_id,d.payload)))=1;
 END IF;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,jsonb_build_object('action','ASSIGN_ACCOUNT_AFFILIATIONS','company_id',target.company_id,'target',target_id,'by',actor_id,'before',target.profile,'after',changes,'date',clock_timestamp()));
END $$;


CREATE OR REPLACE FUNCTION public.workflow_request_choices() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; validators jsonb; managers jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF NOT public.special_coordinator(actor.user_id) THEN RETURN jsonb_build_object('enabled',false); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('uid',user_id,'id',profile->'id','name',profile->>'name','offices',public.account_offices(profile,control_scopes))),'[]') INTO validators
 FROM public.app_profiles WHERE company_id=actor.company_id AND is_active AND role IN ('Validateur','Validatrice')
 AND public.account_offices(profile,control_scopes) ?| ARRAY['B01','B02']
 AND (coalesce(actor.profile->'allowedValidatorIds','[]'::jsonb)='[]'::jsonb OR actor.profile->'allowedValidatorIds' ? (profile->>'id'));
 SELECT coalesce(jsonb_agg(jsonb_build_object('uid',user_id,'id',profile->'id','name',profile->>'name','scopes',control_scopes)),'[]') INTO managers FROM public.app_profiles WHERE company_id=actor.company_id AND is_active AND role='Gestionnaire';
 RETURN jsonb_build_object('enabled',true,'offices',public.account_offices(actor.profile,actor.control_scopes),'services',public.account_services(actor.profile),'validators',validators,'managers',managers);
END $$;

CREATE OR REPLACE FUNCTION public.guard_request_validation_office() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; previous jsonb; selected app_profiles; manager app_profiles; item jsonb; changed boolean; coordinator jsonb; special_owner boolean; technician jsonb; eligible jsonb;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 previous:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
 SELECT * INTO actor FROM current_app_profile();
 changed:=EXISTS(SELECT 1 FROM unnest(ARRAY['requestedValidatorUid','requestedValidationOffice','requestedManagerUid']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k);
 IF TG_OP='UPDATE' AND NOT changed AND EXISTS(SELECT 1 FROM unnest(ARRAY['validationOffice','selectedValidatorId','selectedValidatorName','requestedManagerName','eligibleValidatorIds']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k) THEN RAISE EXCEPTION 'Le circuit de validation du bon est protÃ©gÃ©.'; END IF;
 IF changed OR (special_coordinator(actor.user_id) AND (TG_OP='INSERT' OR (previous->>'status'='EN ATTENTE COORDINATION' AND NEW.payload->>'status' IN ('EN ATTENTE VALIDATEUR','EN ATTENTE GESTIONNAIRE')))) THEN
  IF NOT special_coordinator(actor.user_id) OR actor.company_id IS DISTINCT FROM NEW.company_id OR NEW.payload->>'coordinateurId' IS DISTINCT FROM actor.profile->>'id'
   OR (TG_OP='UPDATE' AND (previous->>'status' IS DISTINCT FROM 'EN ATTENTE COORDINATION' OR NEW.payload->>'status' NOT IN ('EN ATTENTE COORDINATION','EN ATTENTE VALIDATEUR','EN ATTENTE GESTIONNAIRE'))) THEN RAISE EXCEPTION 'Choix du circuit rÃ©servÃ© au coordinateur spÃ©cial avant transmission.'; END IF;
  SELECT * INTO selected FROM app_profiles WHERE user_id::text=NEW.payload->>'requestedValidatorUid' AND company_id=actor.company_id AND is_active AND role IN ('Validateur','Validatrice');
  IF selected.user_id IS NULL OR coalesce(NEW.payload->>'requestedValidationOffice','') NOT IN ('B01','B02') OR NOT account_offices(selected.profile,selected.control_scopes) ? (NEW.payload->>'requestedValidationOffice') OR (actor.profile->>'crossOfficeDirectOrder'='true' AND (NEW.payload->>'requestedValidationOffice' IS DISTINCT FROM NEW.payload->>'originOffice' OR NOT account_offices(actor.profile,actor.control_scopes) ? (NEW.payload->>'requestedValidationOffice') OR NOT account_services(actor.profile) ? (NEW.payload->>'serviceAbbreviation') OR ((NEW.payload->>'requestedValidationOffice'='B01') AND NEW.payload->>'serviceAbbreviation' NOT IN ('MBM','MFTTH','CIDATA','PROD','DR','MNM','DESS','LS')) OR ((NEW.payload->>'requestedValidationOffice'='B02') AND NEW.payload->>'serviceAbbreviation' NOT IN ('B2B','DEP','MAIN')))) THEN RAISE EXCEPTION 'Choisissez un validateur actif du bureau 01 ou 02.'; END IF;
  SELECT * INTO manager FROM app_profiles WHERE user_id::text=NEW.payload->>'requestedManagerUid' AND company_id=actor.company_id AND is_active AND role='Gestionnaire';
  IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Choisissez un gestionnaire actif.'; END IF;
  IF jsonb_typeof(NEW.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matÃ©riel.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'items') LOOP
   IF actor.profile->>'crossOfficeDirectOrder'='true' AND NOT (CASE NEW.payload->>'requestedValidationOffice' WHEN 'B01' THEN workflow_op(coalesce(item->>'op',NEW.payload->>'op'))=ANY(ARRAY['ITC-B01','OCI','CIC','MTN']) WHEN 'B02' THEN workflow_op(coalesce(item->>'op',NEW.payload->>'op'))=ANY(ARRAY['ITC-B02','MOOV']) ELSE false END) THEN RAISE EXCEPTION 'Le stock s?lectionn? ne correspond pas au bureau choisi.'; END IF;
   IF manager.control_scopes->workflow_op(coalesce(item->>'op',NEW.payload->>'op')) IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Le gestionnaire choisi ne gÃ¨re pas tous les stocks demandÃ©s.'; END IF;
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
   IF eligible='[]'::jsonb THEN RAISE EXCEPTION 'Aucun validateur commun autorisÃ© pour ce bureau. Contactez le responsable.'; END IF;
   NEW.payload:=NEW.payload||jsonb_build_object('eligibleValidatorIds',eligible);
  END IF;
 END IF;
 RETURN NEW;
END $$;



DO $$
DECLARE target public.app_profiles; uid text; scopes jsonb; keys jsonb; changes jsonb;
BEGIN
 SELECT p.* INTO target FROM public.app_profiles p JOIN auth.users u ON u.id=p.user_id WHERE lower(trim(u.email))='konanchristian@ivoiretechnocom.ci' AND p.company_id='COMP-ITC-LEGACY' FOR UPDATE;
 IF target.user_id IS NOT NULL THEN uid:=coalesce(target.firebase_uid,target.user_id::text); END IF;
 IF target.user_id IS NULL THEN RAISE EXCEPTION 'Compte konanchristian introuvable dans COMP-ITC-LEGACY.'; END IF;
 IF target.role NOT IN ('Coordinateur','Coordinatrice') THEN RAISE EXCEPTION 'Le compte cibl? doit ?tre coordinateur.'; END IF;
 scopes:=target.control_scopes||jsonb_build_object('ITC-B01',true,'ITC-B02',true,'OCI',true,'CIC',true,'MTN',true,'MOOV',true);
 keys:=target.control_scope_keys||jsonb_build_object(target.company_id||'|ITC-B01',true,target.company_id||'|ITC-B02',true,target.company_id||'|OCI',true,target.company_id||'|CIC',true,target.company_id||'|MTN',true,target.company_id||'|MOOV',true);
 changes:=jsonb_build_object('office','B01','offices',jsonb_build_array('B01','B02'),'serviceAbbreviation','MBM','services',jsonb_build_array('MBM','MFTTH','CIDATA','B2B','DEP','MAIN'),'crossOfficeDirectOrder',true,'managedOps',jsonb_build_array('ITC-B01','ITC-B02','OCI','CIC','MTN','MOOV'),'controlScopes',scopes,'controlScopeKeys',keys,'stockScopeMode','explicit','canChooseInitialService',false,'affiliationUpdatedAt',clock_timestamp());
 UPDATE public.app_profiles SET profile=profile||changes,control_scopes=scopes,control_scope_keys=keys,updated_at=now() WHERE user_id=target.user_id;
 UPDATE public.app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche applicative du coordinateur introuvable.'; END IF;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,jsonb_build_object('action','ENABLE_CROSS_OFFICE_DIRECT_COORDINATOR','target',target.user_id,'email','konanchristian@ivoiretechnocom.ci','by','migration','after',changes,'date',clock_timestamp()));
END $$;

REVOKE ALL ON FUNCTION public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_account_affiliations(text,text[],text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_request_choices() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
