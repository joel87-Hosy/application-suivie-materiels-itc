-- Resolve migrated accounts without confusing a missing identity with a denial.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.assign_account_affiliations(target_uid text,office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; targets uuid[];
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') THEN RAISE EXCEPTION 'Affectation réservée au responsable connecté de cette entreprise.'; END IF;
 SELECT array_agg(user_id) INTO targets FROM app_profiles WHERE (user_id::text=target_uid OR firebase_uid=target_uid)
 AND (actor.role='SUPER_ADMIN' OR company_id=actor.company_id);
 IF coalesce(cardinality(targets),0)<>1 THEN RAISE EXCEPTION 'Profil du compte introuvable ou ambigu dans votre entreprise. Actualisez la liste des comptes.'; END IF;
 PERFORM set_account_affiliations(actor.user_id,targets[1],office_codes,service_codes,coordinator_ids,validator_ids);
END $$;

CREATE OR REPLACE FUNCTION public.assign_account_affiliations_by_record(target_key text,office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_records; candidates uuid[];
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') THEN RAISE EXCEPTION 'Affectation réservée au responsable connecté de cette entreprise.'; END IF;
 SELECT * INTO target FROM app_records WHERE collection='users' AND record_key=target_key
 AND (actor.role='SUPER_ADMIN' OR company_id=actor.company_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable dans votre entreprise. Actualisez la liste.'; END IF;
 -- Numeric legacy record keys are not Auth IDs. The stable application ID
 -- supplies a fallback only inside the same company, with ambiguity rejected.
 SELECT array_agg(user_id) INTO candidates FROM app_profiles
 WHERE company_id=target.company_id AND (
  user_id::text=target.payload->>'uid' OR firebase_uid=target.payload->>'uid'
  OR user_id::text=target.record_key OR firebase_uid=target.record_key
  OR (nullif(profile->>'id','') IS NOT NULL AND profile->>'id'=target.payload->>'id')
 );
 IF coalesce(cardinality(candidates),0)<>1 THEN RAISE EXCEPTION 'La fiche de ce compte ne correspond pas à un profil unique. Faites vérifier sa liaison Firebase/Supabase.'; END IF;
 PERFORM set_account_affiliations(actor.user_id,candidates[1],office_codes,service_codes,coordinator_ids,validator_ids);
END $$;
REVOKE ALL ON FUNCTION public.assign_account_affiliations_by_record(text,text[],text[],text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_account_affiliations_by_record(text,text[],text[],text[],text[]) TO authenticated;

DO $$
DECLARE definition text; old_check text; old_link text;
BEGIN
 SELECT pg_get_functiondef('public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[])'::regprocedure) INTO definition;
 old_check:='IF actor.user_id IS NULL OR actor.role NOT IN (''Superviseur'',''DG'',''SUPER_ADMIN'') OR target.user_id IS NULL OR (actor.role<>''SUPER_ADMIN'' AND actor.company_id<>target.company_id) THEN RAISE EXCEPTION ''Affectation réservée au responsable de cette entreprise.''; END IF;';
 IF position('Profil du compte introuvable.' IN definition)=0 THEN
  IF position(old_check IN definition)=0 THEN RAISE EXCEPTION 'Version de rattachement incompatible : migration 202609260004 requise.'; END IF;
  definition:=replace(definition,old_check,
   'IF actor.user_id IS NULL OR actor.role NOT IN (''Superviseur'',''DG'',''SUPER_ADMIN'') THEN RAISE EXCEPTION ''Affectation réservée au responsable connecté de cette entreprise.''; END IF;
    IF target.user_id IS NULL THEN RAISE EXCEPTION ''Profil du compte introuvable.''; END IF;
    IF actor.role<>''SUPER_ADMIN'' AND actor.company_id IS DISTINCT FROM target.company_id THEN RAISE EXCEPTION ''Ce compte appartient à une autre entreprise.''; END IF;');
 END IF;
 old_link:='payload->>''uid''=coalesce(target.firebase_uid,target.user_id::text)';
 definition:=replace(definition,old_link,'(payload->>''uid''=target.firebase_uid OR payload->>''uid''=target.user_id::text OR (nullif(target.profile->>''id'','''') IS NOT NULL AND payload->>''id''=target.profile->>''id''))');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
