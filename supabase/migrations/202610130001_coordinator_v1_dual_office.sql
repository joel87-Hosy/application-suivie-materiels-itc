BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
 SELECT pg_get_functiondef('public.register_company_user(uuid,uuid,text,text,text,text,text[])'::regprocedure) INTO definition;
 old_text:='actor.role NOT IN (''Superviseur'',''SUPER_ADMIN'')';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'register_company_user actor guard changed'; END IF;
 definition:=replace(definition,old_text,'actor.role NOT IN (''Superviseur'',''DG'',''SUPER_ADMIN'')');
 old_text:='''Coordinateur'',''Coordinatrice'',''Superviseur Terrain''';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'register_company_user role list changed'; END IF;
 definition:=replace(definition,old_text,'''Coordinateur'',''Coordinatrice'',''Coordinateur V1'',''Superviseur Terrain''');
 EXECUTE definition;

 SELECT pg_get_functiondef('public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[])'::regprocedure) INTO definition;
 old_text:='''Coordinateur'',''Coordinatrice'',''Gestionnaire''';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'register_company_user_multi role list changed'; END IF;
 definition:=replace(definition,old_text,'''Coordinateur'',''Coordinatrice'',''Coordinateur V1'',''Gestionnaire''');
 EXECUTE definition;

 SELECT pg_get_functiondef('public.set_account_affiliations(uuid,uuid,text[],text[],text[],text[])'::regprocedure) INTO definition;
 old_text:='''Technicien'',''Coordinateur'',''Coordinatrice'',''Gestionnaire''';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'set_account_affiliations role list changed'; END IF;
 definition:=replace(definition,old_text,'''Technicien'',''Coordinateur'',''Coordinatrice'',''Coordinateur V1'',''Gestionnaire''');
 old_text:='CASE WHEN target.profile->>''crossOfficeDirectOrder''=''true'' THEN 11 ELSE 3 END';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'set_account_affiliations service limit changed'; END IF;
 definition:=replace(definition,old_text,'CASE WHEN target.role=''Coordinateur V1'' OR target.profile->>''crossOfficeDirectOrder''=''true'' THEN 11 ELSE 3 END');
 old_text:='IF target.profile->>''crossOfficeDirectOrder''=''true'' AND (';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'set_account_affiliations cross-office guard changed'; END IF;
 new_text:='IF target.role=''Coordinateur V1'' AND (NOT (office_codes @> ARRAY[''B01'',''B02'']::text[] AND cardinality(office_codes)=2) OR EXISTS(SELECT 1 FROM unnest(service_codes) s WHERE (s IN (''PROD'',''MBM'',''MFTTH'',''DR'',''MNM'',''DESS'',''LS'',''CIDATA'') AND ''B01''<>ALL(office_codes)) OR (s IN (''B2B'',''DEP'',''MAIN'') AND ''B02''<>ALL(office_codes)))) THEN RAISE EXCEPTION ''Coordinateur V1 : bureaux et services incompatibles.''; END IF;'||E'\n  '||old_text;
 definition:=replace(definition,old_text,new_text);
 old_text:='role IN (''Coordinateur'',''Coordinatrice'') AND profile->>''id''=chosen';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'set_account_affiliations coordinator eligibility changed'; END IF;
 definition:=replace(definition,'role IN (''Coordinateur'',''Coordinatrice'')','role IN (''Coordinateur'',''Coordinatrice'',''Coordinateur V1'')');
 EXECUTE definition;

 SELECT pg_get_functiondef('public.eligible_request_coordinator(text)'::regprocedure) INTO definition;
 old_text:='p.role IN (''Coordinateur'',''Coordinatrice'')';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'eligible_request_coordinator role list changed'; END IF;
 EXECUTE replace(definition,old_text,'p.role IN (''Coordinateur'',''Coordinatrice'',''Coordinateur V1'')');

 SELECT pg_get_functiondef('public.account_affiliation_contacts(text)'::regprocedure) INTO definition;
 old_text:='''Coordinateur'',''Coordinatrice'',''Validateur''';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'account_affiliation_contacts role list changed'; END IF;
 EXECUTE replace(definition,old_text,'''Coordinateur'',''Coordinatrice'',''Coordinateur V1'',''Validateur''');

 SELECT pg_get_functiondef('public.check_affiliation_contact(text,text,text,text[],text[])'::regprocedure) INTO definition;
 old_text:='role IN (''Coordinateur'',''Coordinatrice'')';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'check_affiliation_contact role list changed'; END IF;
 EXECUTE replace(definition,old_text,'role IN (''Coordinateur'',''Coordinatrice'',''Coordinateur V1'')');

 SELECT pg_get_functiondef('public.guard_account_affiliation()'::regprocedure) INTO definition;
 old_text:='actor.role IN (''Technicien'',''Coordinateur'',''Coordinatrice'',''Superviseur Terrain'')';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'guard_account_affiliation coordinator branch changed'; END IF;
 definition:=replace(definition,old_text,'actor.role IN (''Technicien'',''Coordinateur'',''Coordinatrice'',''Superviseur Terrain'',''Coordinateur V1'')');
 old_text:='IF actor.role=''Technicien'' THEN';
 new_text:='IF actor.role=''Coordinateur V1'' AND ((office_code=''B01'' AND service_code NOT IN (''PROD'',''MBM'',''MFTTH'',''DR'',''MNM'',''DESS'',''LS'',''CIDATA'')) OR (office_code=''B02'' AND service_code NOT IN (''B2B'',''DEP'',''MAIN''))) THEN RAISE EXCEPTION ''Choisissez un service compatible avec le bureau.''; END IF;'||E'\n  '||old_text;
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'guard_account_affiliation technician branch changed'; END IF;
 definition:=replace(definition,old_text,new_text);
 EXECUTE definition;

 SELECT pg_get_functiondef('public.workflow_request_choices()'::regprocedure) INTO definition;
 old_text:='IF NOT public.special_coordinator(actor.user_id) THEN';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'workflow_request_choices authorization changed'; END IF;
 definition:=replace(definition,old_text,'IF NOT public.special_coordinator(actor.user_id) AND actor.role<>''Coordinateur V1'' THEN');
 EXECUTE definition;

 SELECT pg_get_functiondef('public.guard_request_validation_office()'::regprocedure) INTO definition;
 old_text:='IF changed OR (special_coordinator(actor.user_id) AND (TG_OP=''INSERT'' OR';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'guard_request_validation_office routing branch changed'; END IF;
 definition:=replace(definition,old_text,'IF changed OR ((special_coordinator(actor.user_id) OR actor.role=''Coordinateur V1'') AND (TG_OP=''INSERT'' OR');
 old_text:='IF NOT special_coordinator(actor.user_id) OR actor.company_id IS DISTINCT FROM NEW.company_id';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'guard_request_validation_office actor guard changed'; END IF;
 definition:=replace(definition,old_text,'IF NOT (special_coordinator(actor.user_id) OR actor.role=''Coordinateur V1'') OR actor.company_id IS DISTINCT FROM NEW.company_id');
 old_text:='actor.profile->>''crossOfficeDirectOrder''=''true'' AND';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'guard_request_validation_office stock checks changed'; END IF;
 definition:=replace(definition,old_text,'(actor.profile->>''crossOfficeDirectOrder''=''true'' OR actor.role=''Coordinateur V1'') AND');
 old_text:='role IN (''Coordinateur'',''Coordinatrice'') AND profile->>''id''=NEW.payload->>''coordinateurId''';
 IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'guard_request_validation_office coordinator lookup changed'; END IF;
 definition:=replace(definition,'role IN (''Coordinateur'',''Coordinatrice'')','role IN (''Coordinateur'',''Coordinatrice'',''Coordinateur V1'')');
 EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION public.change_company_user_role(
 actor_id uuid,target_key text,new_role text,stock_ops text[],
 office_codes text[],service_codes text[],coordinator_ids text[],validator_ids text[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; target public.app_profiles; scopes jsonb; keys jsonb; changes jsonb;
BEGIN
 SELECT * INTO actor FROM public.app_profiles WHERE user_id=actor_id AND is_active FOR SHARE;
 SELECT * INTO target FROM public.app_profiles
  WHERE (coalesce(firebase_uid,user_id::text)=target_key OR user_id::text=target_key)
  FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN')
   OR target.user_id IS NULL OR target.user_id=actor_id
   OR (actor.role<>'SUPER_ADMIN' AND actor.company_id<>target.company_id) THEN
  RAISE EXCEPTION 'Modification de rôle réservée au superviseur ou au directeur de cette entreprise.';
 END IF;
 IF target.role IN ('Superviseur','DG','SUPER_ADMIN') OR new_role NOT IN
  ('Gestionnaire','Magasinier','Contrôleur','Coordinateur','Coordinatrice','Coordinateur V1','Superviseur Terrain','Technicien','Validateur','Validatrice') THEN
  RAISE EXCEPTION 'Ce rôle ne peut pas être modifié ici.';
 END IF;
 IF new_role IN ('Gestionnaire','Validateur','Validatrice') AND coalesce(cardinality(stock_ops),0)=0 THEN
  RAISE EXCEPTION 'Sélectionnez au moins un stock dédié.';
 END IF;
 IF new_role IN ('Contrôleur','Magasinier') THEN stock_ops:=ARRAY[]::text[]; END IF;
 IF new_role='Coordinateur V1' AND (
  stock_ops IS DISTINCT FROM ARRAY['ITC-B01','OCI','CIC','MTN','ITC-B02','MOOV']::text[]
  OR office_codes IS DISTINCT FROM ARRAY['B01','B02']::text[]
  OR cardinality(service_codes) NOT BETWEEN 1 AND 11
  OR EXISTS(SELECT 1 FROM unnest(service_codes) s WHERE s NOT IN ('B2B','DEP','MAIN','PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA'))
 ) THEN RAISE EXCEPTION 'Affectation du Coordinateur V1 invalide.'; END IF;
 scopes:=public.check_assigned_stocks(target.company_id,stock_ops);
 IF new_role IN ('Contrôleur','Magasinier') THEN scopes:='{}'::jsonb; END IF;
 SELECT coalesce(jsonb_object_agg(target.company_id||'|'||key,true),'{}'::jsonb) INTO keys FROM jsonb_each(scopes);
 changes:=jsonb_build_object('role',new_role,'managedOps',to_jsonb(stock_ops),'controlScopes',scopes,
  'controlScopeKeys',keys,'stockScopeMode','explicit','crossOfficeDirectOrder',false,
  'roleUpdatedAt',clock_timestamp(),'roleUpdatedBy',actor_id);
 UPDATE public.app_profiles SET role=new_role,control_scopes=scopes,control_scope_keys=keys,
  profile=(profile||changes),updated_at=now() WHERE user_id=target.user_id;
 UPDATE public.app_records SET payload=payload||changes,updated_at=now()
  WHERE collection='users' AND company_id=target.company_id
   AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche du compte introuvable.'; END IF;
 IF new_role IN ('Technicien','Coordinateur','Coordinatrice','Coordinateur V1','Gestionnaire','Validateur','Validatrice','Superviseur Terrain','Magasinier') THEN
  PERFORM public.set_account_affiliations(actor_id,target.user_id,office_codes,service_codes,
   coalesce(coordinator_ids,ARRAY[]::text[]),coalesce(validator_ids,ARRAY[]::text[]));
 ELSE
  UPDATE public.app_profiles SET profile=profile-ARRAY['office','offices','serviceAbbreviation','services','allowedCoordinatorIds','allowedValidatorIds','validationBureau'],updated_at=now()
   WHERE user_id=target.user_id;
  UPDATE public.app_records SET payload=payload-ARRAY['office','offices','serviceAbbreviation','services','allowedCoordinatorIds','allowedValidatorIds','validationBureau'],updated_at=now()
   WHERE collection='users' AND company_id=target.company_id
    AND payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text);
 END IF;
 INSERT INTO public.app_records(collection,record_key,company_id,payload)
  VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,
   jsonb_build_object('action','CHANGE_COMPANY_USER_ROLE','company_id',target.company_id,
    'target',target.user_id,'beforeRole',target.role,'afterRole',new_role,'by',actor_id,'date',clock_timestamp()));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.change_company_user_role(uuid,text,text,text[],text[],text[],text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_company_user_role(uuid,text,text,text[],text[],text[],text[],text[]) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
