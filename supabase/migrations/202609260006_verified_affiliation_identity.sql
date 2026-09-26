-- Auth identity takes precedence over potentially duplicated legacy numeric IDs.
-- No role, account activation, stock scope or historical bon is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.affiliation_record_identity(company text,record_key text,details jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE strong_ids uuid[]; email_ids uuid[]; weak_ids uuid[]; email_profile app_profiles; account_email text;
BEGIN
 SELECT array_agg(user_id) INTO strong_ids FROM app_profiles
 WHERE user_id::text=details->>'uid' OR firebase_uid=details->>'uid' OR user_id::text=record_key OR firebase_uid=record_key;
 IF coalesce(cardinality(strong_ids),0)>1 THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
 IF cardinality(strong_ids)=1 AND EXISTS(SELECT 1 FROM app_profiles WHERE user_id=strong_ids[1] AND company_id IS DISTINCT FROM company) THEN RETURN jsonb_build_object('state','company_conflict'); END IF;

 account_email:=nullif(lower(trim(details->>'email')),'');
 IF account_email IS NOT NULL THEN
  SELECT array_agg(id) INTO email_ids FROM auth.users WHERE lower(trim(email))=account_email;
  IF coalesce(cardinality(email_ids),0)>1 THEN RETURN jsonb_build_object('state','email_conflict'); END IF;
  IF cardinality(email_ids)=1 THEN
   SELECT * INTO email_profile FROM app_profiles WHERE user_id=email_ids[1];
   IF NOT FOUND THEN RETURN jsonb_build_object('state','profile_missing'); END IF;
   IF email_profile.company_id IS DISTINCT FROM company THEN RETURN jsonb_build_object('state','company_conflict'); END IF;
   IF cardinality(strong_ids)=1 AND strong_ids[1]<>email_ids[1] THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
   RETURN jsonb_build_object('state','resolved','uid',email_ids[1],'method','auth_email');
  END IF;
 END IF;
 IF cardinality(strong_ids)=1 THEN RETURN jsonb_build_object('state','resolved','uid',strong_ids[1],'method','auth_uid'); END IF;
 SELECT array_agg(user_id) INTO weak_ids FROM app_profiles WHERE company_id=company
 AND nullif(profile->>'id','') IS NOT NULL AND profile->>'id'=details->>'id';
 IF cardinality(weak_ids)=1 THEN RETURN jsonb_build_object('state','resolved','uid',weak_ids[1],'method','legacy_id'); END IF;
 RETURN jsonb_build_object('state',CASE WHEN coalesce(cardinality(weak_ids),0)>1 THEN 'legacy_conflict' ELSE 'not_found' END);
END $$;
REVOKE ALL ON FUNCTION public.affiliation_record_identity(text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.assign_account_affiliations_by_record(target_key text,office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_records; identity jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') THEN RAISE EXCEPTION 'Affectation réservée au responsable connecté de cette entreprise.'; END IF;
 SELECT * INTO target FROM app_records WHERE collection='users' AND record_key=target_key
 AND (actor.role='SUPER_ADMIN' OR company_id=actor.company_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable dans votre entreprise. Actualisez la liste.'; END IF;
 identity:=affiliation_record_identity(target.company_id,target.record_key,target.payload);
 IF identity->>'state'='profile_missing' THEN RAISE EXCEPTION 'Le compte Auth existe mais son profil applicatif est absent. Le responsable doit restaurer le profil avant son rattachement.'; END IF;
 IF identity->>'state'='company_conflict' THEN RAISE EXCEPTION 'La fiche et le profil Auth appartiennent à des entreprises différentes. Faites corriger leur liaison.'; END IF;
 IF identity->>'state'='not_found' THEN RAISE EXCEPTION 'Aucun profil Auth correspondant à cette fiche. Vérifiez son adresse email et ses identifiants.'; END IF;
 IF identity->>'state'<>'resolved' THEN RAISE EXCEPTION 'Les identifiants Auth de cette fiche sont contradictoires. Faites vérifier sa liaison avant modification.'; END IF;
 PERFORM set_account_affiliations(actor.user_id,(identity->>'uid')::uuid,office_codes,service_codes,coordinator_ids,validator_ids);
END $$;

-- Use the exact same resolver for writes. Otherwise a shared legacy numeric ID
-- could update an unrelated user's public record despite resolving Auth correctly.
DO $$
DECLARE definition text; old_statement text; new_statement text;
BEGIN
 SELECT pg_get_functiondef('public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[])'::regprocedure) INTO definition;
 old_statement:='UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection=''users'' AND company_id=target.company_id AND (payload->>''uid''=target.firebase_uid OR payload->>''uid''=target.user_id::text OR (nullif(target.profile->>''id'','''') IS NOT NULL AND payload->>''id''=target.profile->>''id''));';
 new_statement:='UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection=''users'' AND company_id=target.company_id AND affiliation_record_identity(company_id,record_key,payload)->>''uid''=target.user_id::text;';
 IF position('affiliation_record_identity(company_id,record_key,payload)' IN definition)=0 THEN
  IF position(old_statement IN definition)=0 THEN RAISE EXCEPTION 'Migration 202609260005 requise avant la correction des identités.'; END IF;
  EXECUTE replace(definition,old_statement,new_statement);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
