BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.account_affiliation_contacts(company text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; contacts jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR (actor.role<>'SUPER_ADMIN' AND actor.company_id IS DISTINCT FROM company) THEN RAISE EXCEPTION 'Correspondants réservés au responsable de cette entreprise.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',profile->>'id','name',profile->>'name','company_id',company_id,'role',role,'is_active',is_active,'offices',account_offices(profile,control_scopes),'services',account_services(profile)) ORDER BY profile->>'name'),'[]') INTO contacts
 FROM app_profiles WHERE company_id=company AND role IN ('Coordinateur','Coordinatrice','Validateur','Validatrice') AND nullif(profile->>'id','') IS NOT NULL;
 RETURN contacts;
END $$;
REVOKE ALL ON FUNCTION public.account_affiliation_contacts(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.account_affiliation_contacts(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_affiliation_contact(company text,chosen text,kind text,office_codes text[],service_codes text[]) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE contact app_profiles; matches integer; label text;
BEGIN
 SELECT count(*) INTO matches FROM app_profiles WHERE company_id=company AND profile->>'id'=chosen
 AND ((kind='Coordinateur' AND role IN ('Coordinateur','Coordinatrice')) OR (kind='Validateur' AND role IN ('Validateur','Validatrice')));
 IF matches<>1 THEN RAISE EXCEPTION '% sélectionné introuvable ou ambigu dans cette entreprise (identifiant %). Actualisez la liste des correspondants.',kind,chosen; END IF;
 SELECT * INTO contact FROM app_profiles WHERE company_id=company AND profile->>'id'=chosen
 AND ((kind='Coordinateur' AND role IN ('Coordinateur','Coordinatrice')) OR (kind='Validateur' AND role IN ('Validateur','Validatrice')));
 label:=coalesce(contact.profile->>'name',chosen);
 IF NOT contact.is_active THEN RAISE EXCEPTION '% « % » est inactif. Choisissez un compte actif.',kind,label; END IF;
 IF NOT account_offices(contact.profile,contact.control_scopes) ?| office_codes THEN RAISE EXCEPTION '% « % » : aucun bureau commun. Ses bureaux : %. Choisissez un correspondant compatible ou faites compléter son rattachement.',kind,label,account_offices(contact.profile,contact.control_scopes); END IF;
 IF kind='Coordinateur' AND NOT account_services(contact.profile) ?| service_codes THEN RAISE EXCEPTION 'Coordinateur « % » : aucun service commun. Ses services : %. Choisissez un coordinateur compatible ou faites compléter son rattachement.',label,account_services(contact.profile); END IF;
END $$;
REVOKE ALL ON FUNCTION public.check_affiliation_contact(text,text,text,text[],text[]) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text; original text;
BEGIN
 SELECT pg_get_functiondef('public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[])'::regprocedure) INTO definition;
 IF position('check_affiliation_contact(' IN definition)=0 THEN
  original:='IF NOT EXISTS(SELECT 1 FROM app_profiles WHERE company_id=target.company_id AND is_active AND role IN (''Coordinateur'',''Coordinatrice'') AND profile->>''id''=chosen AND account_offices(profile,control_scopes) ?| office_codes AND account_services(profile) ?| service_codes) THEN RAISE EXCEPTION ''Coordinateur actif de la même entreprise, bureau et service requis.''; END IF;';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Définition du rattachement incompatible. Appliquez les migrations précédentes.'; END IF;
  definition:=replace(definition,original,'PERFORM check_affiliation_contact(target.company_id,chosen,''Coordinateur'',office_codes,service_codes);');
  original:='IF NOT EXISTS(SELECT 1 FROM app_profiles WHERE company_id=target.company_id AND is_active AND role IN (''Validateur'',''Validatrice'') AND profile->>''id''=chosen AND account_offices(profile,control_scopes) ?| office_codes) THEN RAISE EXCEPTION ''Validateur actif de la même entreprise et du bureau requis.''; END IF;';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Définition des validateurs incompatible. Appliquez les migrations précédentes.'; END IF;
  EXECUTE replace(definition,original,'PERFORM check_affiliation_contact(target.company_id,chosen,''Validateur'',office_codes,service_codes);');
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
