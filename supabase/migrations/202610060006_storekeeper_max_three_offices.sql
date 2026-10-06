-- Allow storekeepers to be assigned to one, two, or three offices.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_account_affiliations(
  actor_id uuid,target_id uuid,office_codes text[],service_codes text[],
  coordinator_ids text[],validator_ids text[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; target public.app_profiles; changes jsonb; chosen text;
BEGIN
 SELECT * INTO actor FROM public.app_profiles WHERE user_id=actor_id AND is_active;
 SELECT * INTO target FROM public.app_profiles WHERE user_id=target_id FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND actor.company_id<>target.company_id) THEN RAISE EXCEPTION 'Affectation réservée au responsable de cette entreprise.'; END IF;
 IF target.role='Magasinier' THEN
  IF coalesce(cardinality(office_codes),0)<1 OR cardinality(office_codes)>3 OR EXISTS(SELECT 1 FROM unnest(office_codes) x WHERE x IS NULL OR x NOT IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO')) OR cardinality(ARRAY(SELECT DISTINCT x FROM unnest(office_codes) x))<>cardinality(office_codes) THEN RAISE EXCEPTION 'Attribuez un à trois bureaux distincts au magasinier.'; END IF;
  changes:=jsonb_build_object('office',office_codes[1],'offices',to_jsonb(office_codes),'validationBureau',office_codes[1],
    'serviceAbbreviation',NULL,'services','[]'::jsonb,'allowedCoordinatorIds','[]'::jsonb,'allowedValidatorIds','[]'::jsonb,
    'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor_id);
 ELSE
  IF target.role NOT IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain') THEN RAISE EXCEPTION 'Ce rôle ne nécessite pas de rattachement.'; END IF;
  IF coalesce(cardinality(office_codes),0)=0 OR cardinality(office_codes)>5 OR EXISTS(SELECT 1 FROM unnest(office_codes) x WHERE x IS NULL OR x NOT IN ('B01','B02','BOUAKE','SAN-PEDRO','YAMOUSSOUKRO')) OR coalesce(cardinality(service_codes),0)=0 OR cardinality(service_codes)>3 OR EXISTS(SELECT 1 FROM unnest(service_codes) x WHERE x IS NULL OR x NOT IN ('B2B','DEP','MAIN','PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA')) THEN RAISE EXCEPTION 'Bureaux et services obligatoires et valides.'; END IF;
  IF coordinator_ids IS NULL OR validator_ids IS NULL OR cardinality(coordinator_ids)>100 OR cardinality(validator_ids)>100 THEN RAISE EXCEPTION 'Liste de correspondants invalide.'; END IF;
  FOREACH chosen IN ARRAY coordinator_ids LOOP
   IF NOT EXISTS(SELECT 1 FROM public.app_profiles WHERE company_id=target.company_id AND is_active AND role IN ('Coordinateur','Coordinatrice') AND profile->>'id'=chosen AND public.account_offices(profile,control_scopes) ?| office_codes AND public.account_services(profile) ?| service_codes) THEN RAISE EXCEPTION 'Coordinateur actif de la même entreprise, bureau et service requis.'; END IF;
  END LOOP;
  FOREACH chosen IN ARRAY validator_ids LOOP
   IF NOT EXISTS(SELECT 1 FROM public.app_profiles WHERE company_id=target.company_id AND is_active AND role IN ('Validateur','Validatrice') AND profile->>'id'=chosen AND public.account_offices(profile,control_scopes) ?| office_codes) THEN RAISE EXCEPTION 'Validateur actif de la même entreprise et du bureau requis.'; END IF;
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

CREATE OR REPLACE FUNCTION public.storekeeper_office(details jsonb,scopes jsonb DEFAULT '{}') RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN jsonb_array_length(public.account_offices(details,scopes)) BETWEEN 1 AND 3 THEN public.account_offices(details,scopes)->>0 ELSE NULL END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
