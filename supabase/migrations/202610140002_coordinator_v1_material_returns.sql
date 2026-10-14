BEGIN;

CREATE OR REPLACE FUNCTION public.submit_coordinator_material_return(
  stock_key text, quantity numeric, reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; source public.app_records; manager public.app_profiles; op text; office_code text; return_key text; result jsonb; decision jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice','Coordinateur V1') THEN RAISE EXCEPTION 'Le retour de mat?riel est r?serv? aux coordinateurs.'; END IF;
  IF quantity IS NULL OR quantity<=0 OR quantity>1000000 OR length(trim(coalesce(reason,'')))=0 THEN RAISE EXCEPTION 'Quantit? et motif du retour obligatoires.'; END IF;
  SELECT * INTO source FROM public.app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR SHARE;
  IF source.record_key IS NULL OR nullif(trim(source.payload->>'label'),'') IS NULL THEN RAISE EXCEPTION 'La ligne du stock d?origine est introuvable.'; END IF;
  op:=public.workflow_op(source.payload->>'op');
  IF coalesce(actor.control_scopes->op,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Ce stock ne rel?ve pas de votre affectation.'; END IF;
  office_code:=public.account_office(actor.profile,actor.control_scopes);
  SELECT * INTO manager FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Gestionnaire' AND p.control_scopes->op='true'::jsonb ORDER BY p.user_id LIMIT 1;
  IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Aucun gestionnaire n?est affect? au stock d?origine.'; END IF;
  return_key:=gen_random_uuid()::text;
  decision:=jsonb_build_object('approved',true,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason','Retour soumis par le coordinateur');
  result:=jsonb_build_object('id','RET-MAT-'||upper(substr(replace(return_key,'-',''),1,10)),'workflow','COORD_MATERIAL_RETURN','status','EN ATTENTE GESTIONNAIRE','statut','EN ATTENTE GESTIONNAIRE',
    'coordinateurId',actor.profile->>'id','coordinateurNom',actor.profile->>'name','demandeurOriginalId',actor.profile->'id','demandeurName',actor.profile->>'name',
    'createdByUid',actor.user_id::text,'assignedGestionnaireUid',manager.user_id::text,'assignedGestionnaireName',manager.profile->>'name',
    'coordinatorDecision',decision,'originOffice',office_code,'validationOffice',office_code,'serviceAbbreviation',actor.profile->>'serviceAbbreviation',
    'op',op,'motif',left(trim(reason),1000),'createdAt',now(),'date',now(),'sourceStockKey',stock_key,
    'items',jsonb_build_array(jsonb_build_object('op',op,'label',source.payload->>'label','qty',quantity,'stockKey',stock_key)));
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('demandes',return_key,actor.company_id,result);
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'userId',manager.profile->'id','lu',false,'date',now(),'createdAt',now(),'section','gestion-retours-materiel','message','RETOUR MAT?RIEL ? R?CEPTION : '||(source.payload->>'label')));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.decide_technician_material_return(request_key text, approve boolean, reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; item jsonb; manager public.app_profiles; decision jsonb; op text;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice','Coordinateur V1') THEN RAISE EXCEPTION 'Action r?serv?e au coordinateur.'; END IF;
  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'workflow'<>'COORD_MATERIAL_RETURN' OR request.payload->>'status'<>'EN ATTENTE COORDINATEUR' OR request.payload->>'assignedCoordinateurUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Retour absent, d?j? trait? ou affect? ? un autre coordinateur.'; END IF;
  IF approve IS NULL OR (NOT approve AND length(trim(coalesce(reason,'')))=0) THEN RAISE EXCEPTION 'D?cision et motif de refus requis.'; END IF;
  item:=request.payload->'items'->0; op:=public.workflow_op(item->>'op');
  decision:=jsonb_build_object('approved',approve,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason',left(trim(coalesce(reason,'')),1000));
  IF approve THEN
    SELECT * INTO manager FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Gestionnaire' AND p.control_scopes->op='true'::jsonb ORDER BY p.user_id LIMIT 1;
    IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Aucun gestionnaire n?est affect? au stock d?origine.'; END IF;
    request.payload:=request.payload||jsonb_build_object('coordinatorDecision',decision,'status','EN ATTENTE GESTIONNAIRE','statut','EN ATTENTE GESTIONNAIRE','assignedGestionnaireUid',manager.user_id::text,'assignedGestionnaireName',manager.profile->>'name');
    INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'userId',manager.profile->'id','lu',false,'date',now(),'createdAt',now(),'section','gestion-retours-materiel','message','RETOUR MAT?RIEL ? R?CEPTION : '||(item->>'label')));
  ELSE request.payload:=request.payload||jsonb_build_object('coordinatorDecision',decision,'status','REFUSEE COORDINATEUR','statut','REFUSEE COORDINATEUR'); END IF;
  UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  RETURN request.payload;
END $$;

REVOKE ALL ON FUNCTION public.submit_coordinator_material_return(text,numeric,text),public.decide_technician_material_return(text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_coordinator_material_return(text,numeric,text),public.decide_technician_material_return(text,boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
