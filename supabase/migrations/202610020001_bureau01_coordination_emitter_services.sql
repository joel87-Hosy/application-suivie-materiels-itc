BEGIN;
CREATE OR REPLACE FUNCTION public.choose_initial_coordinator_service(service_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; changes jsonb; office_code text;
BEGIN
 SELECT * INTO actor FROM app_profiles WHERE user_id=auth.uid() AND is_active FOR UPDATE;
 office_code:=account_office(actor.profile,actor.control_scopes);
 IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice') THEN
  RAISE EXCEPTION 'Choix réservé à la coordination.';
 END IF;
 IF office_code='B01' THEN
  IF service_code IS NULL OR service_code NOT IN ('PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA') THEN
   RAISE EXCEPTION 'Choisissez un service du bureau 01.';
  END IF;
  IF actor.profile->>'serviceAbbreviation' IS NOT DISTINCT FROM service_code THEN RETURN; END IF;
 ELSE
  IF nullif(actor.profile->>'serviceAbbreviation','') IS NOT NULL OR actor.profile->'canChooseInitialService' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'Le responsable doit modifier votre rattachement.';
  END IF;
  IF service_code IS NULL OR service_code NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Service invalide.'; END IF;
 END IF;
 changes:=jsonb_build_object('serviceAbbreviation',service_code,'canChooseInitialService',false,'affiliationUpdatedAt',clock_timestamp(),'affiliationUpdatedBy',actor.user_id);
 UPDATE app_profiles SET profile=profile||changes,updated_at=now() WHERE user_id=actor.user_id;
 UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=actor.company_id AND payload->>'uid'=coalesce(actor.firebase_uid,actor.user_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable.'; END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','CHOOSE_COORDINATOR_SERVICE','company_id',actor.company_id,'by',actor.user_id,'service',service_code,'date',clock_timestamp()));
END $$;
REVOKE ALL ON FUNCTION public.choose_initial_coordinator_service(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.choose_initial_coordinator_service(text) TO authenticated;
COMMIT;
