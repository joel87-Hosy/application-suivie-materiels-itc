-- Debit the stock when the manager signs. The storekeeper signature records handover only.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.debit_manager_approved_bon(request_key text,service text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records;
        item jsonb; idx integer; op text; item_label text; label_key text; stock_key text;
        matches integer; requested numeric; available numeric; substock text;
        debit_items jsonb:='[]'::jsonb; result jsonb; office_code text;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'D?bit r?serv? au gestionnaire affect?.'; END IF;
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon affect? ? un autre gestionnaire.'; END IF;
 IF request.payload->>'managerDebitAt' IS NOT NULL THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE MAGASINIER' OR request.payload->>'managerSignedAt' IS NULL OR request.payload->>'managerSignedByUid' IS DISTINCT FROM actor.user_id::text OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation et signature du gestionnaire requises avant le d?bit.'; END IF;
 IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans mat?riel.'; END IF;
 office_code:=public.storekeeper_request_office(actor.company_id,request.payload);
 IF (office_code='B01' AND service NOT IN ('PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA'))
   OR (office_code='B02' AND service NOT IN ('B2B','DEP','MAIN'))
   OR (office_code NOT IN ('B01','B02') AND service NOT IN ('B2B','DEP','MAIN')) THEN RAISE EXCEPTION 'Service ?metteur invalide pour le bureau du bon.'; END IF;
 PERFORM 1 FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 FOR idx IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
   item:=request.payload->'items'->idx;
   op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op'));
   item_label:=coalesce(item->>'label','');
   requested:=nullif(item->>'qty','')::numeric;
   stock_key:=coalesce(nullif(item->>'stockKey',''),nullif(item->>'_dbKey',''));
   substock:=item->>'substock';
   IF requested IS NULL OR requested<=0 OR coalesce(actor.control_scopes->op,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Quantit? ou stock non autoris? pour %.',item_label; END IF;
   IF (office_code='B01' AND op NOT IN ('ITC-B01','OCI','CIC','MTN')) OR (office_code='B02' AND op NOT IN ('ITC-B02','MOOV')) THEN RAISE EXCEPTION 'Le stock % ne correspond pas au bureau du bon.',op; END IF;
   label_key:=upper(regexp_replace(replace(replace(replace(replace(trim(item_label),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'));
   matches:=0; stockrow:=NULL;
   IF stock_key IS NOT NULL THEN
     SELECT count(*) INTO matches FROM public.app_records s WHERE s.collection='stock' AND s.company_id=actor.company_id AND s.record_key=stock_key
       AND public.workflow_op(coalesce(s.payload->>'op',s.payload->>'operator'))=op
       AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(s.payload->>'label',s.payload->>'name',s.payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key;
     IF matches=1 THEN SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id AND record_key=stock_key FOR UPDATE; END IF;
   ELSE
     SELECT count(*) INTO matches FROM public.app_records s WHERE s.collection='stock' AND s.company_id=actor.company_id
       AND public.workflow_op(coalesce(s.payload->>'op',s.payload->>'operator'))=op
       AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(s.payload->>'label',s.payload->>'name',s.payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key;
     IF matches=1 THEN SELECT * INTO stockrow FROM public.app_records s WHERE s.collection='stock' AND s.company_id=actor.company_id
       AND public.workflow_op(coalesce(s.payload->>'op',s.payload->>'operator'))=op
       AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(s.payload->>'label',s.payload->>'name',s.payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key FOR UPDATE; END IF;
   END IF;
   IF matches<>1 OR stockrow.record_key IS NULL THEN RAISE EXCEPTION 'Article absent ou ambigu dans le stock : % / % (correspondances : %).',op,item_label,matches; END IF;
   available:=coalesce(nullif(stockrow.payload->>'qty','')::numeric,0);
   IF available<requested THEN RAISE EXCEPTION 'Stock insuffisant : % (disponible : %, demand? : %).',item_label,available,requested; END IF;
   IF op IN ('ITC-B02','MOOV') AND substock IS NOT NULL AND substock NOT IN ('production','deploiement','maintenance','unallocated') THEN RAISE EXCEPTION 'Sous-stock invalide.'; END IF;
   IF office_code='B01' AND substock IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM public.manager_substock_categories c
      WHERE c.company_id=actor.company_id AND c.stock_op=op AND c.id::text=substock
   ) THEN RAISE EXCEPTION 'Sous-stock invalide pour le Bureau 01.'; END IF;
   UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb(coalesce(nullif(payload->>'qty','')::numeric,0)-requested),true)
      ||CASE WHEN substock IS NOT NULL THEN jsonb_build_object('_substockDebit',substock) ELSE '{}'::jsonb END,updated_at=now()
    WHERE collection='stock' AND record_key=stockrow.record_key AND company_id=actor.company_id;
   debit_items:=debit_items||jsonb_build_array(jsonb_build_object('index',idx,'stockKey',stockrow.record_key,'op',op,'label',item_label,'qty',requested,'substock',substock));
 END LOOP;
 result:=request.payload||jsonb_build_object('managerDebitAt',clock_timestamp(),'managerDebitByUid',actor.user_id,'managerDebitItems',debit_items,'stockDebitSource','GESTIONNAIRE');
 UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','DEBIT_BON_SIGNATURE_GESTIONNAIRE','company_id',actor.company_id,'requestKey',request_key,'manager',actor.user_id,'items',debit_items,'date',clock_timestamp()));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.issue_stock_request_signed(request_key text,signer_name text,signature_image text,service text,selections jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Signature r?serv?e au gestionnaire affect?.'; END IF;
 IF selections IS NOT NULL THEN RAISE EXCEPTION 'La remise des articles est sign?e par le magasinier apr?s d?bit du gestionnaire.'; END IF;
 result:=public.issue_stock_request_signed_storekeeper(request_key,signer_name,signature_image,service,NULL);
 IF result->>'managerDebitAt' IS NULL AND result->>'status'='EN ATTENTE MAGASINIER' THEN
   result:=public.debit_manager_approved_bon(request_key,service);
 END IF;
 RETURN result;
END $$;

-- Record the physical handover without changing stock a second time.
CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed(request_key text,items jsonb,signer_name text,signature_image text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; selection jsonb; item jsonb; service_state jsonb; served_map jsonb; events jsonb;
        event_items jsonb:='[]'::jsonb; event jsonb; evidence jsonb; idx integer; qty numeric; served numeric; requested numeric; op text;
        all_served boolean:=true; i integer; result jsonb; stock_key text; sortie_key text;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Service r?serv? au magasinier.'; END IF;
 IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Cochez au moins un mat?riel ? remettre.'; END IF;
 IF (SELECT count(DISTINCT (value->>'index')::integer) FROM jsonb_array_elements(items))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Un mat?riel ne peut ?tre s?lectionn? qu?une fois.'; END IF;
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'status' NOT IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') OR request.payload->>'managerDebitAt' IS NULL
   OR NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN RAISE EXCEPTION 'Bon non d?bit? par le gestionnaire, hors de votre bureau ou d?j? servi.'; END IF;
 service_state:=coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
 served_map:=coalesce(service_state->'servedByItem','{}'::jsonb); events:=coalesce(service_state->'events','[]'::jsonb);
 FOR selection IN SELECT value FROM jsonb_array_elements(items) ORDER BY (value->>'index')::integer LOOP
   idx:=(selection->>'index')::integer; qty:=(selection->>'quantity')::numeric;
   IF idx<0 OR idx>=jsonb_array_length(request.payload->'items') OR qty IS NULL OR qty<=0 THEN RAISE EXCEPTION 'S?lection de mat?riel invalide.'; END IF;
   item:=request.payload->'items'->idx; requested:=(item->>'qty')::numeric; served:=coalesce(((served_map->idx::text)->>'qty')::numeric,0);
   IF requested IS NULL OR qty>requested-served THEN RAISE EXCEPTION 'Quantit? servie sup?rieure au reliquat pour %.',item->>'label'; END IF;
   op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op'));
   SELECT coalesce(d.value->>'stockKey',item->>'stockKey') INTO stock_key FROM jsonb_array_elements(coalesce(request.payload->'managerDebitItems','[]'::jsonb)) AS d(value) WHERE (d.value->>'index')::integer=idx LIMIT 1;
   served:=served+qty;
   served_map:=jsonb_set(served_map,ARRAY[idx::text],jsonb_build_object('qty',served,'lastAt',clock_timestamp(),'stockKey',stock_key),true);
   event_items:=event_items||jsonb_build_array(jsonb_build_object('index',idx,'label',item->>'label','op',op,'qty',qty,'stockKey',stock_key));
 END LOOP;
 evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
 event:=jsonb_build_object('at',clock_timestamp(),'uid',actor.user_id,'name',actor.profile->>'name','signature',evidence,'items',event_items);
 events:=events||jsonb_build_array(event);
 FOR i IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
   item:=request.payload->'items'->i; requested:=(item->>'qty')::numeric; served:=coalesce(((served_map->i::text)->>'qty')::numeric,0);
   IF requested IS NULL OR served<requested THEN all_served:=false; END IF;
 END LOOP;
 service_state:=jsonb_build_object('servedByItem',served_map,'events',events);
 sortie_key:=gen_random_uuid()::text;
 result:=request.payload||jsonb_build_object('materialService',service_state,
   'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('storekeeper',evidence),
   'status',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
   'statut',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
   'validatedAt',event->'at','validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',event->'at',
   'sortieId',coalesce(request.payload->>'sortieId',sortie_key));
 UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('sorties',sortie_key,actor.company_id,
   result||jsonb_build_object('id',sortie_key,'sourceDemandeId',request.payload->>'id','items',event_items,'date',event->'at','createdBy',actor.profile->>'name','storekeeperSignature',evidence,'partialIssue',NOT all_served));
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','BON_MATERIEL_SERVI','company_id',actor.company_id,'requestId',request.payload->>'id','event',event,'final',all_served));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed_v2(request_key text,items jsonb,unavailable_items jsonb,signer_name text,signature_image text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 IF actor.role IS DISTINCT FROM 'Magasinier' OR request.record_key IS NULL OR request.payload->>'managerDebitAt' IS NULL
   OR NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN RAISE EXCEPTION 'Bon non d?bit? par le gestionnaire ou hors de votre bureau.'; END IF;
 IF coalesce(jsonb_array_length(unavailable_items),0)>0 THEN RAISE EXCEPTION 'Le gestionnaire a d?bit? les quantit?s valid?es; signalez toute anomalie au responsable avant la remise.'; END IF;
 RETURN public.dispense_stock_bon_signed(request_key,items,signer_name,signature_image);
END $$;

CREATE OR REPLACE FUNCTION public.inspect_stock_bon(bon_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; request jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Scanner r?serv? au magasinier.'; END IF;
 result:=public.inspect_stock_bon_unscoped(bon_id); request:=result->'bon';
 IF NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request) THEN RAISE EXCEPTION 'Bon hors de votre bureau.'; END IF;
 IF request->>'managerDebitAt' IS NULL THEN result:=result||jsonb_build_object('state','A_VALIDER','canIssue',false); END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.debit_manager_approved_bon(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_stock_request_signed(text,text,text,text,jsonb),public.dispense_stock_bon_signed(text,jsonb,text,text),public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text),public.inspect_stock_bon(text) TO authenticated;
REVOKE ALL ON FUNCTION public.dispense_stock_bon_signed(text,jsonb,text,text),public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text),public.inspect_stock_bon(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_stock_request_signed_storekeeper(text,text,text,text,jsonb),public.issue_validated_request_before_validity(text,text,text),public.dispense_stock_bon_signed_unscoped(text,jsonb,text,text),public.dispense_stock_bon_signed_v2_unscoped(text,jsonb,jsonb,text,text),public.inspect_stock_bon_unscoped(text) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
