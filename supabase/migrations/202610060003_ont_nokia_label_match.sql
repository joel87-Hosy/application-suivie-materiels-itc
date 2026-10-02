BEGIN;

-- Match ONT NOKIA by both words regardless of label order or punctuation.
CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed(request_key text,items jsonb,signer_name text,signature_image text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; selection jsonb; item jsonb; selected_item jsonb;
        service_state jsonb; served_map jsonb; events jsonb; event_items jsonb:='[]'::jsonb; event jsonb; evidence jsonb;
        idx integer; qty numeric; served numeric; requested numeric; op text; stock_key text; stock_count integer; all_served boolean:=true; i integer; ignore_stock boolean;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Sortie réservée au magasinier.'; END IF;
 IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Cochez au moins un matériel à remettre.'; END IF;
 IF (SELECT count(DISTINCT (value->>'index')::integer) FROM jsonb_array_elements(items))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Un matériel ne peut être sélectionné qu’une fois.'; END IF;
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'status' NOT IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') OR request.payload->>'managerSignedAt' IS NULL THEN RAISE EXCEPTION 'Bon non autorisé au service ou déjà entièrement servi.'; END IF;
 service_state:=coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
 served_map:=coalesce(service_state->'servedByItem','{}'::jsonb); events:=coalesce(service_state->'events','[]'::jsonb);
 IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Le bon ne contient aucun article.'; END IF;
 -- Lock stock rows in a stable order so simultaneous cashiers cannot overspend.
 PERFORM 1 FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 FOR selection IN SELECT value FROM jsonb_array_elements(items) ORDER BY (value->>'index')::integer LOOP
   idx:=(selection->>'index')::integer; qty:=(selection->>'quantity')::numeric;
   IF idx<0 OR idx>=jsonb_array_length(request.payload->'items') OR qty IS NULL OR qty<=0 THEN RAISE EXCEPTION 'Sélection de matériel invalide.'; END IF;
   item:=request.payload->'items'->idx; requested:=(item->>'qty')::numeric; served:=coalesce(((served_map->(idx::text))->>'qty')::numeric,0);
   IF requested IS NULL OR qty>requested-served THEN RAISE EXCEPTION 'Quantité déjà servie ou supérieure au reliquat pour %.',item->>'label'; END IF;
   op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op')); stock_key:=coalesce(nullif(item->>'stockKey',''),nullif(item->>'_dbKey',''));
   ignore_stock:=position('ont' in lower(regexp_replace(coalesce(item->>'label',''),'[^a-z0-9]','','g')))>0
     AND position('nokia' in lower(regexp_replace(coalesce(item->>'label',''),'[^a-z0-9]','','g')))>0;
   IF NOT ignore_stock AND stock_key IS NOT NULL THEN
     SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id AND record_key=stock_key FOR UPDATE;
     IF stockrow.record_key IS NULL OR public.workflow_op(coalesce(stockrow.payload->>'op',stockrow.payload->>'operator')) IS DISTINCT FROM op
       OR upper(trim(coalesce(stockrow.payload->>'label',stockrow.payload->>'name',stockrow.payload->>'designation'))) IS DISTINCT FROM upper(trim(item->>'label')) THEN
       RAISE EXCEPTION 'La ligne de stock du matériel % est absente ou a changé.',item->>'label';
     END IF;
   ELSIF NOT ignore_stock THEN
     SELECT count(*) INTO stock_count FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id
       AND public.workflow_op(coalesce(payload->>'op',payload->>'operator'))=op
       AND upper(regexp_replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),'[[:space:]]+',' ','g'))
         =upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g'));
     IF stock_count<>1 THEN RAISE EXCEPTION 'Article absent ou ambigu dans le stock : % / %.',op,item->>'label'; END IF;
     SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id
       AND public.workflow_op(coalesce(payload->>'op',payload->>'operator'))=op
       AND upper(regexp_replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),'[[:space:]]+',' ','g'))
         =upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g')) FOR UPDATE;
   END IF;
   IF NOT ignore_stock THEN
     IF coalesce((stockrow.payload->>'qty')::numeric,0)<qty THEN RAISE EXCEPTION 'Stock insuffisant pour % (disponible : %).',item->>'label',stockrow.payload->>'qty'; END IF;
     UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-qty),true),updated_at=now()
       WHERE collection='stock' AND record_key=stockrow.record_key AND company_id=actor.company_id;
   END IF;
   served:=served+qty;
   served_map:=jsonb_set(served_map,ARRAY[idx::text],jsonb_build_object('qty',served,'lastAt',clock_timestamp(),'stockKey',CASE WHEN ignore_stock THEN NULL ELSE stockrow.record_key END),true);
   event_items:=event_items||jsonb_build_array(jsonb_build_object('index',idx,'label',item->>'label','op',op,'qty',qty,'stockKey',CASE WHEN ignore_stock THEN NULL ELSE stockrow.record_key END,'stockDebitSkipped',ignore_stock));
 END LOOP;
 evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
 event:=jsonb_build_object('at',clock_timestamp(),'uid',actor.user_id,'name',actor.profile->>'name','signature',evidence,'items',event_items);
 events:=events||jsonb_build_array(event);
 FOR i IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
   item:=request.payload->'items'->i; requested:=(item->>'qty')::numeric; served:=coalesce(((served_map->(i::text))->>'qty')::numeric,0);
   IF requested IS NULL OR served<requested THEN all_served:=false; END IF;
 END LOOP;
 service_state:=jsonb_build_object('servedByItem',served_map,'events',events);
 request.payload:=request.payload||jsonb_build_object('materialService',service_state,
   'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('storekeeper',evidence),
   'status',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
   'statut',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
   'validatedAt',event->'at','validatedBy',actor.profile->>'name','validatedById',actor.profile->'id',
   'dateLivraison',event->'at','sortieId',coalesce(request.payload->>'sortieId',gen_random_uuid()::text));
 UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('sorties',gen_random_uuid()::text,actor.company_id,
   request.payload||jsonb_build_object('id',gen_random_uuid()::text,'sourceDemandeId',request.payload->>'id','items',event_items,
     'date',event->'at','createdBy',actor.profile->>'name','storekeeperSignature',evidence,'partialIssue',NOT all_served));
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','BON_MATERIEL_SERVI','company_id',actor.company_id,'requestId',request.payload->>'id','event',event,'final',all_served));
 RETURN request.payload;
END $$;

COMMIT;
