BEGIN;

CREATE OR REPLACE FUNCTION public.submit_coordinator_material_return(
  stock_key text, quantity numeric, reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; stockrow public.app_records; manager public.app_profiles; validator public.app_profiles; return_key text; operator text; label text; office_code text; result jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice') THEN RAISE EXCEPTION 'Le retour de matériel est réservé aux coordinateurs.'; END IF;
  IF quantity IS NULL OR quantity <= 0 OR quantity > 1000000 THEN RAISE EXCEPTION 'Quantité de retour invalide.'; END IF;
  IF length(trim(coalesce(reason,'')))=0 THEN RAISE EXCEPTION 'Le motif du retour est obligatoire.'; END IF;
  SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR SHARE;
  IF stockrow.record_key IS NULL THEN RAISE EXCEPTION 'Le stock d’origine est introuvable.'; END IF;
  operator := public.workflow_op(stockrow.payload->>'op'); label := stockrow.payload->>'label';
  IF operator IS NULL OR label IS NULL OR coalesce((stockrow.payload->>'qty')::numeric,0) <= 0 THEN RAISE EXCEPTION 'Cet article ne peut pas faire l’objet d’un retour.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_profiles manager WHERE manager.company_id=actor.company_id AND manager.is_active AND manager.role='Gestionnaire' AND manager.control_scopes->operator='true'::jsonb) THEN
    RAISE EXCEPTION 'Aucun gestionnaire n’est affecté à ce stock.';
  END IF;
  office_code := public.account_office(actor.profile,actor.control_scopes);
  IF office_code IS NULL THEN RAISE EXCEPTION 'Aucun bureau n’est rattaché à votre compte.'; END IF;
  IF public.special_coordinator(actor.user_id) THEN
    SELECT * INTO manager FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Gestionnaire'
      AND p.control_scopes->operator='true'::jsonb ORDER BY p.user_id LIMIT 1;
    SELECT * INTO validator FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active
      AND p.role IN ('Validateur','Validatrice') AND public.account_offices(p.profile,p.control_scopes) ? office_code
      AND (coalesce(actor.profile->'allowedValidatorIds','[]'::jsonb)='[]'::jsonb OR actor.profile->'allowedValidatorIds' ? (p.profile->>'id'))
      ORDER BY p.user_id LIMIT 1;
    IF manager.user_id IS NULL OR validator.user_id IS NULL OR office_code NOT IN ('B01','B02') THEN
      RAISE EXCEPTION 'Aucun gestionnaire ou validateur dédié n’est affecté à ce retour.';
    END IF;
  END IF;
  return_key := gen_random_uuid()::text;
  result := jsonb_build_object('id','RET-MAT-'||upper(substr(replace(return_key,'-',''),1,10)),
    'workflow','COORD_MATERIAL_RETURN','status','EN ATTENTE VALIDATEUR','statut','EN ATTENTE VALIDATEUR',
    'coordinateurId',actor.profile->>'id','coordinateurNom',actor.profile->>'name',
    'demandeurOriginalId',actor.profile->'id','demandeurName',actor.profile->>'name',
    'createdByUid',coalesce(actor.firebase_uid,actor.user_id::text),'originOffice',office_code,'validationOffice',office_code,
    'serviceAbbreviation',actor.profile->>'serviceAbbreviation','op',operator,'motif',left(trim(reason),1000),
    'createdAt',now(),'date',now(),'sourceStockKey',stock_key,
    'items',jsonb_build_array(jsonb_build_object('op',operator,'label',label,'qty',quantity,'stockKey',stock_key)));
  IF public.special_coordinator(actor.user_id) THEN
    result := result || jsonb_build_object('requestedValidationOffice',office_code,'requestedValidatorUid',validator.user_id::text,
      'requestedManagerUid',manager.user_id::text);
  END IF;
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('demandes',return_key,actor.company_id,result);
  SELECT payload INTO result FROM public.app_records WHERE collection='demandes' AND record_key=return_key;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.decide_coordinator_material_return(request_key text, approve boolean, reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; item jsonb; decision jsonb; qty numeric; operator text;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Action réservée au gestionnaire du stock.'; END IF;
  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'workflow' IS DISTINCT FROM 'COORD_MATERIAL_RETURN'
     OR request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Retour absent, non validé ou déjà traité.';
  END IF;
  IF request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Ce retour est affecté à un autre gestionnaire.'; END IF;
  item := request.payload->'items'->0; operator := public.workflow_op(item->>'op'); qty := (item->>'qty')::numeric;
  IF qty IS NULL OR qty<=0 OR coalesce(actor.control_scopes->operator,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Ce stock n’est pas géré par votre compte ou la quantité est invalide.'; END IF;
  IF approve IS NULL THEN RAISE EXCEPTION 'Décision requise.'; END IF;
  IF NOT approve AND length(trim(coalesce(reason,'')))=0 THEN RAISE EXCEPTION 'Le motif du refus est obligatoire.'; END IF;
  decision := jsonb_build_object('approved',approve,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason',left(trim(coalesce(reason,'')),1000));
  IF approve THEN
    SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND record_key=request.payload->>'sourceStockKey' AND company_id=actor.company_id FOR UPDATE;
    IF stockrow.record_key IS NULL OR public.workflow_op(stockrow.payload->>'op') IS DISTINCT FROM operator OR stockrow.payload->>'label' IS DISTINCT FROM item->>'label' THEN RAISE EXCEPTION 'La ligne du stock d’origine est absente ou a changé.'; END IF;
    UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb(coalesce((payload->>'qty')::numeric,0)+qty),true),updated_at=now()
      WHERE collection='stock' AND record_key=stockrow.record_key AND company_id=actor.company_id;
    request.payload := request.payload || jsonb_build_object('status','RETOUR REINTEGRE','statut','RETOUR REINTEGRE','managerDecision',decision||jsonb_build_object('quantity',qty,'stockKey',stockrow.record_key,'op',operator));
  ELSE
    request.payload := request.payload || jsonb_build_object('status','REFUSEE GESTIONNAIRE','statut','REFUSEE GESTIONNAIRE','managerDecision',decision);
  END IF;
  UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
    jsonb_build_object('action',CASE WHEN approve THEN 'RETOUR_MATERIEL_REINTEGRE' ELSE 'RETOUR_MATERIEL_REFUSE' END,'requestId',request.payload->>'id',
      'decision',decision,'sourceStockKey',request.payload->>'sourceStockKey','company_id',actor.company_id));
  RETURN request.payload;
END $$;

REVOKE ALL ON FUNCTION public.submit_coordinator_material_return(text,numeric,text), public.decide_coordinator_material_return(text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_coordinator_material_return(text,numeric,text), public.decide_coordinator_material_return(text,boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
