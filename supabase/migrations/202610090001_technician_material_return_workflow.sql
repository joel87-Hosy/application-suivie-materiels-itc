BEGIN;

CREATE OR REPLACE FUNCTION public.submit_technician_material_return(
  stock_key text, quantity numeric, reason text, coordinator_id text, item_condition text DEFAULT 'NEUF'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; source public.app_records; coordinator public.app_profiles; manager public.app_profiles; op text; office_code text; return_key text; result jsonb; substock text; held numeric;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Technicien' THEN RAISE EXCEPTION 'Retour réservé aux techniciens.'; END IF;
  IF quantity IS NULL OR quantity<=0 OR quantity>1000000 THEN RAISE EXCEPTION 'Quantité de retour invalide.'; END IF;
  IF length(trim(coalesce(reason,'')))=0 THEN RAISE EXCEPTION 'Le motif du retour est obligatoire.'; END IF;
  SELECT * INTO source FROM public.app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR UPDATE;
  IF source.record_key IS NULL OR nullif(trim(source.payload->>'label'),'') IS NULL THEN RAISE EXCEPTION 'La ligne de stock d’origine est introuvable.'; END IF;
  op:=public.workflow_op(source.payload->>'op'); office_code:=public.account_office(actor.profile,actor.control_scopes);
  SELECT coalesce(sum((i.value->>'qty')::numeric),0) INTO held
    FROM public.app_records d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.payload->'items','[]'::jsonb)) i
    WHERE d.collection='demandes' AND d.company_id=actor.company_id AND d.payload->>'status'='LIVREE'
      AND (d.payload->>'technicienUid'=actor.user_id::text OR d.payload->>'createdByUid'=actor.user_id::text OR d.payload->>'demandeurOriginalId'=actor.profile->>'id')
      AND public.workflow_op(coalesce(i.value->>'op',d.payload->>'op'))=op AND upper(trim(i.value->>'label'))=upper(trim(source.payload->>'label'));
  SELECT held-coalesce(sum((i.value->>'qty')::numeric),0) INTO held
    FROM public.app_records d CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.payload->'items','[]'::jsonb)) i
    WHERE d.collection='demandes' AND d.company_id=actor.company_id AND d.payload->>'workflow'='COORD_MATERIAL_RETURN'
      AND d.payload->>'status' IN ('EN ATTENTE COORDINATEUR','EN ATTENTE GESTIONNAIRE','RETOUR REINTEGRE')
      AND d.payload->>'technicienUid'=actor.user_id::text AND d.payload->>'sourceStockKey'=stock_key;
  IF coalesce(held,0)<quantity THEN RAISE EXCEPTION 'La quantité dépasse le matériel qui vous a été remis et reste en votre possession.'; END IF;
  IF office_code IS NULL OR NOT (CASE office_code WHEN 'B01' THEN op=ANY(ARRAY['ITC-B01','OCI','CIC','MTN']) WHEN 'B02' THEN op=ANY(ARRAY['ITC-B02','MOOV']) WHEN 'BOUAKE' THEN op='ITC-BOUAKE' WHEN 'SAN-PEDRO' THEN op='ITC-SAN-PEDRO' WHEN 'YAMOUSSOUKRO' THEN op='ITC-YAMOUSSOUKRO' ELSE false END) THEN RAISE EXCEPTION 'Ce matériel ne provient pas d’un stock de votre bureau.'; END IF;
  SELECT * INTO coordinator FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role IN ('Coordinateur','Coordinatrice') AND p.profile->>'id'=coordinator_id
    AND public.account_offices(p.profile,p.control_scopes) ? office_code
    AND (coalesce(actor.profile->'allowedCoordinatorIds','[]'::jsonb)='[]'::jsonb OR actor.profile->'allowedCoordinatorIds' ? coordinator_id)
    AND (public.account_services(actor.profile)='[]'::jsonb OR public.account_services(p.profile) ?| ARRAY(SELECT jsonb_array_elements_text(public.account_services(actor.profile))))
    LIMIT 1;
  IF coordinator.user_id IS NULL THEN RAISE EXCEPTION 'Aucun coordinateur autorisé ne correspond à votre bureau et service.'; END IF;
  SELECT * INTO manager FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Gestionnaire' AND p.control_scopes->op='true'::jsonb ORDER BY p.user_id LIMIT 1;
  IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Aucun gestionnaire n’est affecté au stock d’origine.'; END IF;
  substock:=CASE WHEN op IN ('ITC-B02','MOOV') THEN CASE upper(coalesce(actor.profile->>'serviceAbbreviation','')) WHEN 'B2B' THEN 'production' WHEN 'DEP' THEN 'deploiement' WHEN 'MAIN' THEN 'maintenance' ELSE NULL END ELSE NULL END;
  return_key:=gen_random_uuid()::text;
  result:=jsonb_build_object('id','RET-MAT-'||upper(substr(replace(return_key,'-',''),1,10)),'workflow','COORD_MATERIAL_RETURN','status','EN ATTENTE COORDINATEUR','statut','EN ATTENTE COORDINATEUR',
    'demandeurOriginalId',actor.profile->'id','demandeurName',actor.profile->>'name','technicienId',actor.profile->>'id','technicienUid',actor.user_id::text,'technicienName',actor.profile->>'name',
    'createdByUid',actor.user_id::text,'assignedCoordinateurUid',coordinator.user_id::text,'assignedCoordinateurId',coordinator.profile->>'id','assignedCoordinateurName',coordinator.profile->>'name',
    'coordinateurId',coordinator.profile->>'id','coordinateurNom',coordinator.profile->>'name','originOffice',office_code,'validationOffice',office_code,
    'serviceAbbreviation',actor.profile->>'serviceAbbreviation','op',op,'motif',left(trim(reason),1000),'condition',left(coalesce(item_condition,'NEUF'),40),
    'createdAt',now(),'date',now(),'sourceStockKey',stock_key,
    'items',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('op',op,'label',source.payload->>'label','qty',quantity,'stockKey',stock_key,'substock',substock))));
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('demandes',return_key,actor.company_id,result);
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'userId',coordinator.profile->'id','lu',false,'date',now(),'createdAt',now(),'section','coord-retour-materiel','message','RETOUR MATÉRIEL À VALIDER : '||(source.payload->>'label')));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.decide_technician_material_return(request_key text, approve boolean, reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; item jsonb; manager public.app_profiles; decision jsonb; op text;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice') THEN RAISE EXCEPTION 'Action réservée au coordinateur.'; END IF;
  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'workflow'<>'COORD_MATERIAL_RETURN' OR request.payload->>'status'<>'EN ATTENTE COORDINATEUR' OR request.payload->>'assignedCoordinateurUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Retour absent, déjà traité ou affecté à un autre coordinateur.'; END IF;
  IF approve IS NULL OR (NOT approve AND length(trim(coalesce(reason,'')))=0) THEN RAISE EXCEPTION 'Décision et motif de refus requis.'; END IF;
  item:=request.payload->'items'->0; op:=public.workflow_op(item->>'op');
  decision:=jsonb_build_object('approved',approve,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason',left(trim(coalesce(reason,'')),1000));
  IF approve THEN
    SELECT * INTO manager FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Gestionnaire' AND p.control_scopes->op='true'::jsonb ORDER BY p.user_id LIMIT 1;
    IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Aucun gestionnaire n’est affecté au stock d’origine.'; END IF;
    request.payload:=request.payload||jsonb_build_object('coordinatorDecision',decision,'status','EN ATTENTE GESTIONNAIRE','statut','EN ATTENTE GESTIONNAIRE','assignedGestionnaireUid',manager.user_id::text,'assignedGestionnaireName',manager.profile->>'name');
    INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'userId',manager.profile->'id','lu',false,'date',now(),'createdAt',now(),'section','gestion-retours-materiel','message','RETOUR MATÉRIEL À RÉCEPTION : '||(item->>'label')));
  ELSE request.payload:=request.payload||jsonb_build_object('coordinatorDecision',decision,'status','REFUSEE COORDINATEUR','statut','REFUSEE COORDINATEUR'); END IF;
  UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  RETURN request.payload;
END $$;

CREATE OR REPLACE FUNCTION public.decide_coordinator_material_return(request_key text, approve boolean, reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; item jsonb; decision jsonb; qty numeric; op text; substock text; buckets jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Action réservée au gestionnaire du stock.'; END IF;
  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'workflow' IS DISTINCT FROM 'COORD_MATERIAL_RETURN' OR request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE'
     OR (request.payload#>>'{coordinatorDecision,approved}' IS DISTINCT FROM 'true' AND request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Retour absent, non validé ou déjà traité.'; END IF;
  IF request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Ce retour est affecté à un autre gestionnaire.'; END IF;
  item:=request.payload->'items'->0; op:=public.workflow_op(item->>'op'); qty:=(item->>'qty')::numeric; substock:=item->>'substock';
  IF qty IS NULL OR qty<=0 OR coalesce(actor.control_scopes->op,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Ce stock n’est pas géré par votre compte ou la quantité est invalide.'; END IF;
  IF approve IS NULL OR (NOT approve AND length(trim(coalesce(reason,'')))=0) THEN RAISE EXCEPTION 'Décision et motif de refus requis.'; END IF;
  decision:=jsonb_build_object('approved',approve,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason',left(trim(coalesce(reason,'')),1000));
  IF approve THEN
    SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND record_key=request.payload->>'sourceStockKey' AND company_id=actor.company_id FOR UPDATE;
    IF stockrow.record_key IS NULL OR public.workflow_op(stockrow.payload->>'op') IS DISTINCT FROM op OR stockrow.payload->>'label' IS DISTINCT FROM item->>'label' THEN RAISE EXCEPTION 'La ligne du stock d’origine est absente ou a changé.'; END IF;
    buckets:=coalesce(stockrow.payload->'subStocks','{}'::jsonb);
    IF substock IN ('production','deploiement','maintenance') AND op IN ('ITC-B02','MOOV') THEN
      buckets:=jsonb_set(buckets,ARRAY[substock],to_jsonb(coalesce((buckets->>substock)::numeric,0)+qty),true);
      stockrow.payload:=jsonb_set(stockrow.payload,'{subStocks}',buckets,true);
    END IF;
    stockrow.payload:=jsonb_set(stockrow.payload,'{qty}',to_jsonb(coalesce((stockrow.payload->>'qty')::numeric,0)+qty),true);
    UPDATE public.app_records SET payload=stockrow.payload,updated_at=now() WHERE collection='stock' AND record_key=stockrow.record_key AND company_id=actor.company_id;
    INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('stockMovements',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'op',op,'label',item->>'label','qty',qty,'type','in','source','technician_return','stockKey',stockrow.record_key,'actorUid',actor.user_id,'createdAt',now(),'reference',request.payload->>'id'));
    request.payload:=request.payload||jsonb_build_object('status','RETOUR REINTEGRE','statut','RETOUR REINTEGRE','managerDecision',decision||jsonb_build_object('quantity',qty,'stockKey',stockrow.record_key,'op',op));
  ELSE request.payload:=request.payload||jsonb_build_object('status','REFUSEE GESTIONNAIRE','statut','REFUSEE GESTIONNAIRE','managerDecision',decision); END IF;
  UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action',CASE WHEN approve THEN 'RETOUR_MATERIEL_REINTEGRE' ELSE 'RETOUR_MATERIEL_REFUSE' END,'requestId',request.payload->>'id','decision',decision,'sourceStockKey',request.payload->>'sourceStockKey','company_id',actor.company_id));
  RETURN request.payload;
END $$;

REVOKE ALL ON FUNCTION public.submit_technician_material_return(text,numeric,text,text,text),public.decide_technician_material_return(text,boolean,text),public.decide_coordinator_material_return(text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_technician_material_return(text,numeric,text,text,text),public.decide_technician_material_return(text,boolean,text),public.decide_coordinator_material_return(text,boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
