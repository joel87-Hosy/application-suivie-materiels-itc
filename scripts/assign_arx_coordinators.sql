-- Run as project administrator in the Supabase SQL editor, after migrations
-- 202609260006 and 202609270001. ARX is a B02 / B2B technician.
-- Select eligible coordinators by affiliation, not by a hard-coded email list.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
DECLARE
 target public.app_profiles;
 contact public.app_profiles;
 account_id uuid;
 matches integer;
 chosen_ids text[] := ARRAY[]::text[];
 offices text[];
 services text[];
 changes jsonb;
 recovered_id jsonb;
 candidate_ids text[];
BEGIN
 -- Prevent another account edit from claiming an ID during this repair.
 LOCK TABLE public.app_profiles,public.app_records IN SHARE ROW EXCLUSIVE MODE;
 SELECT count(*),min(id::text)::uuid INTO matches,account_id
 FROM auth.users WHERE lower(trim(email))='arx-group@itc.ci';
 IF matches<>1 THEN RAISE EXCEPTION 'Compte Auth ARX absent ou ambigu.'; END IF;
 SELECT * INTO target FROM public.app_profiles WHERE user_id=account_id FOR UPDATE;
 IF target.user_id IS NULL OR target.role<>'Technicien' THEN
  RAISE EXCEPTION 'Profil Technicien ARX requis. Aucun changement effectué.';
 END IF;
 offices:=ARRAY['B02'];
 services:=ARRAY['B2B'];
 -- Restore missing profile IDs only from existing, unambiguously linked user
 -- records. Preserve the original JSON type for legacy numeric identifiers.
 FOR contact IN SELECT p.* FROM public.app_profiles p JOIN auth.users a ON a.id=p.user_id
  WHERE lower(trim(a.email)) IN ('kablanjonas@ivoiretechnocom.ci','keanange@ivoiretechnocom.ci')
   AND p.company_id=target.company_id AND p.is_active
   AND p.role IN ('Coordinateur','Coordinatrice')
   AND public.account_offices(p.profile,p.control_scopes) ? 'B02'
   AND public.account_services(p.profile) ? 'B2B'
   AND nullif(p.profile->>'id','') IS NULL
 LOOP
  SELECT array_agg(DISTINCT payload->>'id') INTO candidate_ids
  FROM public.app_records WHERE collection='users' AND company_id=target.company_id
   AND public.affiliation_record_identity(company_id,record_key,payload)->>'uid'=contact.user_id::text
   AND jsonb_typeof(payload->'id') IN ('number','string') AND nullif(payload->>'id','') IS NOT NULL;
  IF coalesce(cardinality(candidate_ids),0)<>1 THEN
   RAISE EXCEPTION 'Identifiant historique absent ou contradictoire pour le coordinateur %. Aucune modification appliquée.',contact.user_id;
  END IF;
  IF EXISTS(SELECT 1 FROM public.app_profiles WHERE company_id=target.company_id
    AND user_id<>contact.user_id AND profile->>'id'=candidate_ids[1])
   OR EXISTS(SELECT 1 FROM public.app_records WHERE collection='users' AND company_id=target.company_id
    AND payload->>'id'=candidate_ids[1]
    AND (public.affiliation_record_identity(company_id,record_key,payload)->>'uid') IS DISTINCT FROM contact.user_id::text) THEN
   RAISE EXCEPTION 'Identifiant historique % déjà utilisé par une autre fiche. Aucune modification appliquée.',candidate_ids[1];
  END IF;
  SELECT payload->'id' INTO recovered_id FROM public.app_records
   WHERE collection='users' AND company_id=target.company_id
    AND payload->>'id'=candidate_ids[1]
    AND public.affiliation_record_identity(company_id,record_key,payload)->>'uid'=contact.user_id::text
   ORDER BY record_key LIMIT 1;
  UPDATE public.app_profiles SET profile=profile||jsonb_build_object('id',recovered_id),updated_at=now()
   WHERE user_id=contact.user_id;
  INSERT INTO public.app_records(collection,record_key,company_id,payload,updated_at)
   VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,
    jsonb_build_object('action','RESTORE_COORDINATOR_APPLICATION_ID','target',contact.user_id,
     'before',contact.profile->'id','after',recovered_id,'byDatabaseRole',current_user,'date',clock_timestamp()),now());
 END LOOP;
 FOR contact IN SELECT * FROM public.app_profiles p
  WHERE p.company_id=target.company_id AND p.is_active
   AND p.role IN ('Coordinateur','Coordinatrice')
   AND nullif(p.profile->>'id','') IS NOT NULL
   AND public.account_offices(p.profile,p.control_scopes) ? 'B02'
   AND public.account_services(p.profile) ? 'B2B'
  ORDER BY p.user_id FOR SHARE
 LOOP
  PERFORM public.check_affiliation_contact(target.company_id,contact.profile->>'id','Coordinateur',offices,services);
  chosen_ids:=array_append(chosen_ids,contact.profile->>'id');
 END LOOP;
 IF cardinality(chosen_ids)=0 THEN
  RAISE EXCEPTION 'Aucun coordinateur actif B02 / B2B dans l’entreprise ARX (%). Exécutez scripts/diagnose_arx_coordinators.sql.',target.company_id;
 END IF;
 changes:=jsonb_build_object('office','B02','offices',to_jsonb(offices),
  'serviceAbbreviation','B2B','services',to_jsonb(services),
  'canChooseInitialService',false,'allowedCoordinatorIds',to_jsonb(chosen_ids));
 UPDATE public.app_records SET payload=payload||changes,updated_at=now()
 WHERE collection='users' AND company_id=target.company_id
 AND public.affiliation_record_identity(company_id,record_key,payload)->>'uid'=target.user_id::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche publique ARX introuvable. Aucun changement effectué.'; END IF;
 UPDATE public.app_profiles SET profile=profile||changes,updated_at=now() WHERE user_id=target.user_id;
 IF target.profile||changes IS DISTINCT FROM target.profile THEN
  INSERT INTO public.app_records(collection,record_key,company_id,payload,updated_at)
  VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,
   jsonb_build_object('action','ASSIGN_ARX_COORDINATORS','company_id',target.company_id,
    'target',target.user_id,'byDatabaseRole',current_user,
    'before',target.profile,'after',changes,'date',clock_timestamp()),now());
 END IF;
END $$;
COMMIT;

SELECT a.email,p.role,p.company_id,p.profile->>'office' AS bureau,
 p.profile->>'serviceAbbreviation' AS service,p.profile->'allowedCoordinatorIds' AS coordinator_ids
FROM public.app_profiles p JOIN auth.users a ON a.id=p.user_id
WHERE lower(trim(a.email))='arx-group@itc.ci';
