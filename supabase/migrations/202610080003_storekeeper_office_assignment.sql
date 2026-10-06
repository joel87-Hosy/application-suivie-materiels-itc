-- Attach each storekeeper to one to three offices and route signed service by office.
-- the bon's office and the selected storekeeper account.
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

CREATE OR REPLACE FUNCTION public.register_company_user_multi(
 actor_id uuid,new_user_id uuid,company text,user_role text,user_name text,
 user_email text,stock_ops text[],office_codes text[],service_codes text[],
 coordinator_ids text[],validator_ids text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.register_company_user(actor_id,new_user_id,company,user_role,user_name,user_email,stock_ops);
 IF user_role IN ('Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain','Magasinier') THEN
  PERFORM public.set_account_affiliations(actor_id,new_user_id,office_codes,service_codes,coordinator_ids,validator_ids);
 END IF;
 SELECT profile-'email' INTO result FROM public.app_profiles WHERE user_id=new_user_id;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.storekeeper_office(details jsonb,scopes jsonb DEFAULT '{}') RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN jsonb_array_length(public.account_offices(details,scopes)) BETWEEN 1 AND 3 THEN public.account_offices(details,scopes)->>0 ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public.storekeeper_has_office(details jsonb,scopes jsonb,office_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT public.storekeeper_office(details,scopes) IS NOT NULL AND public.account_offices(details,scopes) ? office_code;
$$;

CREATE OR REPLACE FUNCTION public.storekeeper_request_office(company text,request jsonb) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(nullif(request->>'validationOffice',''),nullif(request->>'originOffice',''),public.request_origin_office(company,request));
$$;

CREATE OR REPLACE FUNCTION public.storekeeper_covers_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.storekeeper_has_office(details,scopes,public.storekeeper_request_office(company,request))
   AND request->>'assignedMagasinierUid'=details->>'uid';
$$;

CREATE OR REPLACE FUNCTION public.storekeeper_can_read_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.storekeeper_has_office(details,scopes,public.storekeeper_request_office(company,request))
   AND (request->>'assignedMagasinierUid'=details->>'uid' OR EXISTS(
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(request#>'{materialService,events}')='array' THEN request#>'{materialService,events}' ELSE '[]'::jsonb END) event
     WHERE coalesce(event->>'uid',event->>'storekeeperUid')=details->>'uid'));
$$;

-- Preserve the current decision implementation behind office-aware RPCs.
ALTER FUNCTION public.decide_stock_request_signed(text,boolean,uuid,text,text,text)
 RENAME TO decide_stock_request_signed_unassigned;
CREATE OR REPLACE FUNCTION public.decide_stock_request_signed(
 request_key text,approve boolean,manager_uid uuid,reason text,signer_name text,signature_image text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; storekeeper public.app_profiles; target_office text; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF actor.role NOT IN ('Validateur','Validatrice') OR request.record_key IS NULL
   OR NOT public.validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,request.payload)
   OR NOT public.validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre bureau ou de vos autorisations de signature.'; END IF;
 target_office:=public.storekeeper_request_office(actor.company_id,request.payload);
 IF approve AND target_office IS DISTINCT FROM 'B01' THEN
   SELECT * INTO storekeeper FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Magasinier'
     AND public.storekeeper_has_office(p.profile,p.control_scopes,target_office);
   IF (SELECT count(*) FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Magasinier' AND public.storekeeper_has_office(p.profile,p.control_scopes,target_office))<>1 THEN
     RAISE EXCEPTION 'Choisissez un magasinier actif rattaché au bureau du bon.';
   END IF;
 END IF;
 result:=public.decide_stock_request_signed_unassigned(request_key,approve,manager_uid,reason,signer_name,signature_image);
 IF approve AND storekeeper.user_id IS NOT NULL THEN
   result:=result||jsonb_build_object('assignedMagasinierUid',storekeeper.user_id,'assignedMagasinierName',storekeeper.profile->>'name');
   UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.workflow_storekeepers() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role NOT IN ('Validateur','Validatrice') THEN RAISE EXCEPTION 'Liste réservée aux validateurs.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('uid',user_id,'id',profile->'id','name',profile->>'name','offices',public.account_offices(profile,control_scopes)) ORDER BY profile->>'name'),'[]'::jsonb)
 INTO result FROM public.app_profiles WHERE company_id=actor.company_id AND is_active AND role='Magasinier'
   AND public.storekeeper_office(profile,control_scopes) IS NOT NULL
   AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(public.account_offices(actor.profile,actor.control_scopes)) office(value)
     WHERE public.account_offices(profile,control_scopes) ? office.value);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.decide_stock_request_signed_assigned(
 request_key text,approve boolean,manager_uid uuid,storekeeper_uid uuid,reason text,
 signer_name text,signature_image text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; storekeeper public.app_profiles; target_office text; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF actor.role NOT IN ('Validateur','Validatrice') OR request.record_key IS NULL
   OR NOT public.validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,request.payload)
   OR NOT public.validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre bureau ou de vos autorisations de signature.'; END IF;
 target_office:=public.storekeeper_request_office(actor.company_id,request.payload);
 IF approve AND target_office IS DISTINCT FROM 'B01' THEN
   SELECT * INTO storekeeper FROM public.app_profiles p WHERE p.user_id=storekeeper_uid AND p.company_id=actor.company_id AND p.is_active AND p.role='Magasinier'
     AND public.storekeeper_has_office(p.profile,p.control_scopes,target_office);
   IF storekeeper.user_id IS NULL THEN RAISE EXCEPTION 'Choisissez un magasinier actif rattaché au bureau de ce bon.'; END IF;
 END IF;
 result:=public.decide_stock_request_signed_unassigned(request_key,approve,manager_uid,reason,signer_name,signature_image);
 IF approve THEN
   result:=result||jsonb_build_object('assignedMagasinierUid',storekeeper.user_id,'assignedMagasinierName',storekeeper.profile->>'name');
   UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.assign_storekeeper_to_pending_bon(request_key text,storekeeper_uid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; storekeeper public.app_profiles; office_code text; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF actor.role NOT IN ('Validateur','Validatrice') OR request.record_key IS NULL
   OR request.payload->>'status' NOT IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI')
   OR request.payload->>'managerSignedAt' IS NULL
   OR NOT public.validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,request.payload)
   OR NOT public.validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre bureau ou de vos autorisations.'; END IF;
 office_code:=public.storekeeper_request_office(actor.company_id,request.payload);
 SELECT * INTO storekeeper FROM public.app_profiles p WHERE p.user_id=storekeeper_uid AND p.company_id=actor.company_id AND p.is_active AND p.role='Magasinier'
   AND public.storekeeper_has_office(p.profile,p.control_scopes,office_code);
 IF storekeeper.user_id IS NULL THEN RAISE EXCEPTION 'Choisissez un magasinier actif du bureau du bon.'; END IF;
 result:=request.payload||jsonb_build_object('assignedMagasinierUid',storekeeper.user_id,'assignedMagasinierName',storekeeper.profile->>'name');
 UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','ASSIGN_BON_MAGASINIER','company_id',actor.company_id,'requestKey',request_key,'storekeeper',storekeeper.user_id,'by',actor.user_id,'date',clock_timestamp()));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.workflow_storekeepers(),public.decide_stock_request_signed_assigned(text,boolean,uuid,uuid,text,text,text),public.assign_storekeeper_to_pending_bon(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workflow_storekeepers(),public.decide_stock_request_signed_assigned(text,boolean,uuid,uuid,text,text,text),public.assign_storekeeper_to_pending_bon(text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.decide_stock_request_signed(text,boolean,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stock_request_signed(text,boolean,uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.decide_stock_request_signed_unassigned(text,boolean,uuid,text,text,text) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION public.confirm_bon_renewal_signed(text,jsonb,boolean,text,text,text)
 RENAME TO confirm_bon_renewal_signed_unscoped;
CREATE FUNCTION public.confirm_bon_renewal_signed(
 request_key text,expected_valid_until jsonb,approve boolean,reason text,signer_name text,signature_image text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 IF actor.role NOT IN ('Validateur','Validatrice') OR request.record_key IS NULL
   OR request.payload#>>'{validatorDecision,uid}' IS DISTINCT FROM actor.user_id::text
   OR NOT public.validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,request.payload)
   OR NOT public.validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre bureau ou de vos autorisations de signature.'; END IF;
 RETURN public.confirm_bon_renewal_signed_unscoped(request_key,expected_valid_until,approve,reason,signer_name,signature_image);
END $$;
REVOKE ALL ON FUNCTION public.confirm_bon_renewal_signed(text,jsonb,boolean,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_bon_renewal_signed(text,jsonb,boolean,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_bon_renewal_signed_unscoped(text,jsonb,boolean,text,text,text),public.confirm_bon_renewal(text,jsonb,boolean,text) FROM PUBLIC,anon,authenticated;

-- Filter storekeeper reads/signatures at the server as well as in the UI.
ALTER FUNCTION public.inspect_stock_bon(text) RENAME TO inspect_stock_bon_unscoped;
CREATE FUNCTION public.inspect_stock_bon(bon_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; request jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Magasinier' OR public.storekeeper_office(actor.profile,actor.control_scopes) IS NULL THEN RAISE EXCEPTION 'Attribuez un à trois bureaux au magasinier.'; END IF;
 result:=public.inspect_stock_bon_unscoped(bon_id);
 request:=result->'bon';
 IF NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request) THEN RAISE EXCEPTION 'Bon non affecté à votre compte ou à votre bureau.'; END IF;
 RETURN result;
END $$;

ALTER FUNCTION public.dispense_stock_bon_signed(text,jsonb,text,text) RENAME TO dispense_stock_bon_signed_unscoped;
CREATE FUNCTION public.dispense_stock_bon_signed(request_key text,items jsonb,signer_name text,signature_image text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 IF actor.role IS DISTINCT FROM 'Magasinier' OR request.record_key IS NULL OR NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN RAISE EXCEPTION 'Bon non affecté à votre compte ou à votre bureau.'; END IF;
 RETURN public.dispense_stock_bon_signed_unscoped(request_key,items,signer_name,signature_image);
END $$;

ALTER FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text) RENAME TO dispense_stock_bon_signed_v2_unscoped;
CREATE FUNCTION public.dispense_stock_bon_signed_v2(request_key text,items jsonb,unavailable_items jsonb,signer_name text,signature_image text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 IF actor.role IS DISTINCT FROM 'Magasinier' OR request.record_key IS NULL OR NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN RAISE EXCEPTION 'Bon non affecté à votre compte ou à votre bureau.'; END IF;
 RETURN public.dispense_stock_bon_signed_v2_unscoped(request_key,items,unavailable_items,signer_name,signature_image);
END $$;

REVOKE ALL ON FUNCTION public.inspect_stock_bon(text),public.dispense_stock_bon_signed(text,jsonb,text,text),public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inspect_stock_bon(text),public.dispense_stock_bon_signed(text,jsonb,text,text),public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.inspect_stock_bon_unscoped(text),public.dispense_stock_bon_signed_unscoped(text,jsonb,text,text),public.dispense_stock_bon_signed_v2_unscoped(text,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.can_read_company_app_record(collection_name text,record_company text,record_payload jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.user_id IS NULL OR record_company IS DISTINCT FROM actor.company_id THEN RETURN false; END IF;
 IF collection_name<>'demandes' THEN RETURN true; END IF;
 IF actor.role IN ('Validateur','Validatrice') THEN
   RETURN public.validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,record_payload)
     AND public.validator_covers_request(actor.control_scopes,record_payload);
ELSIF actor.role='Magasinier' THEN
   RETURN public.storekeeper_can_read_request(actor.profile,actor.control_scopes,actor.company_id,record_payload);
 END IF;
 RETURN true;
END $$;

DROP POLICY IF EXISTS app_records_tenant_read ON public.app_records;
CREATE POLICY app_records_tenant_read ON public.app_records FOR SELECT TO authenticated
 USING (public.is_app_admin() OR public.can_read_company_app_record(collection,company_id,payload));
REVOKE ALL ON FUNCTION public.can_read_company_app_record(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_company_app_record(text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.storekeeper_can_read_request(jsonb,jsonb,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.storekeeper_can_read_request(jsonb,jsonb,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.decide_stock_request(text,boolean,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.storekeeper_office(jsonb,jsonb),public.storekeeper_has_office(jsonb,jsonb,text),public.storekeeper_request_office(text,jsonb),public.storekeeper_covers_request(jsonb,jsonb,text,jsonb),public.storekeeper_can_read_request(jsonb,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guard_storekeeper_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE previous jsonb;
BEGIN
 IF NEW.collection<>'demandes' OR current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 previous:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
 IF TG_OP='INSERT' AND nullif(NEW.payload->>'assignedMagasinierUid','') IS NOT NULL THEN RAISE EXCEPTION 'Seul le validateur peut affecter le magasinier au bon.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['assignedMagasinierUid','assignedMagasinierName']) k WHERE NEW.payload->k IS DISTINCT FROM previous->k) THEN RAISE EXCEPTION 'L’affectation du magasinier est gérée par le circuit de validation.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_guard_storekeeper_assignment ON public.app_records;
CREATE TRIGGER zz_guard_storekeeper_assignment BEFORE INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_storekeeper_assignment();
NOTIFY pgrst,'reload schema';
COMMIT;
