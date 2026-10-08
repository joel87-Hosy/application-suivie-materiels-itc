-- A validated bon can be handed over and signed by the storekeeper without
-- waiting for the manager. When the manager has not debited it already, the
-- storekeeper's signed handover debits the selected stock rows atomically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed_v2(
  request_key text, items jsonb, unavailable_items jsonb,
  signer_name text, signature_image text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor public.app_profiles; request public.app_records; stockrow public.app_records;
  selection jsonb; item jsonb; service_state jsonb; served_map jsonb; events jsonb;
  event_items jsonb:='[]'::jsonb; event jsonb; evidence jsonb; result jsonb;
  idx integer; qty numeric; served numeric; requested numeric; op text; stock_key text;
  stock_count integer; all_served boolean:=true; i integer; direct_debit boolean;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Service réservé au magasinier.'; END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Cochez au moins un matériel à remettre.'; END IF;
  IF coalesce(jsonb_array_length(unavailable_items),0)>0 THEN RAISE EXCEPTION 'Les articles indisponibles doivent être traités avec le responsable avant la remise.'; END IF;
  IF (SELECT count(DISTINCT (value->>'index')::integer) FROM jsonb_array_elements(items))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Un matériel ne peut être sélectionné qu’une fois.'; END IF;

  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'status' NOT IN ('EN ATTENTE GESTIONNAIRE','EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI')
     OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true'
     OR NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN
    RAISE EXCEPTION 'Bon non validé, hors de votre bureau ou déjà entièrement servi.';
  END IF;
  IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;

  direct_debit:=request.payload->>'managerDebitAt' IS NULL;
  service_state:=coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
  served_map:=coalesce(service_state->'servedByItem','{}'::jsonb);
  events:=coalesce(service_state->'events','[]'::jsonb);
  IF direct_debit THEN PERFORM 1 FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE; END IF;

  FOR selection IN SELECT value FROM jsonb_array_elements(items) ORDER BY (value->>'index')::integer LOOP
    idx:=(selection->>'index')::integer; qty:=(selection->>'quantity')::numeric;
    IF idx<0 OR idx>=jsonb_array_length(request.payload->'items') OR qty IS NULL OR qty<=0 THEN RAISE EXCEPTION 'Sélection de matériel invalide.'; END IF;
    item:=request.payload->'items'->idx; requested:=(item->>'qty')::numeric;
    served:=coalesce(((served_map->idx::text)->>'qty')::numeric,0);
    IF requested IS NULL OR qty>requested-served THEN RAISE EXCEPTION 'Quantité servie supérieure au reliquat pour %.',item->>'label'; END IF;
    op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op'));
    stock_key:=coalesce(nullif(item->>'stockKey',''),nullif(item->>'_dbKey',''),
      (SELECT value->>'stockKey' FROM jsonb_array_elements(coalesce(request.payload->'managerDebitItems','[]'::jsonb)) WHERE (value->>'index')::integer=idx LIMIT 1));

    IF direct_debit THEN
      stockrow:=NULL; stock_count:=0;
      IF stock_key IS NOT NULL THEN
        SELECT count(*) INTO stock_count FROM public.app_records s WHERE s.collection='stock' AND s.company_id=actor.company_id AND s.record_key=stock_key
          AND public.workflow_op(coalesce(s.payload->>'op',s.payload->>'operator'))=op
          AND upper(regexp_replace(trim(coalesce(s.payload->>'label',s.payload->>'name',s.payload->>'designation')),'[[:space:]]+',' ','g'))=upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g'));
        IF stock_count=1 THEN SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR UPDATE; END IF;
      ELSE
        SELECT count(*) INTO stock_count FROM public.app_records s WHERE s.collection='stock' AND s.company_id=actor.company_id
          AND public.workflow_op(coalesce(s.payload->>'op',s.payload->>'operator'))=op
          AND upper(regexp_replace(trim(coalesce(s.payload->>'label',s.payload->>'name',s.payload->>'designation')),'[[:space:]]+',' ','g'))=upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g'));
        IF stock_count=1 THEN SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id
          AND public.workflow_op(coalesce(payload->>'op',payload->>'operator'))=op
          AND upper(regexp_replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),'[[:space:]]+',' ','g'))=upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g')) FOR UPDATE; END IF;
      END IF;
      IF stock_count<>1 OR stockrow.record_key IS NULL THEN RAISE EXCEPTION 'Article absent ou ambigu dans le stock : % / %.',op,item->>'label'; END IF;
      IF coalesce((stockrow.payload->>'qty')::numeric,0)<qty THEN RAISE EXCEPTION 'Stock insuffisant pour %.',item->>'label'; END IF;
      stock_key:=stockrow.record_key;
      UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-qty),true),updated_at=now()
        WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id;
      INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('stockMovements',gen_random_uuid()::text,actor.company_id,
        jsonb_build_object('company_id',actor.company_id,'op',op,'label',item->>'label','qty',qty,'type','out','source','storekeeper_signed_handover','stockKey',stock_key,'actorUid',actor.user_id,'createdAt',clock_timestamp(),'reference',request.payload->>'id'));
    END IF;

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
  result:=request.payload||jsonb_build_object('materialService',service_state,
    'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('storekeeper',evidence),
    'status',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
    'statut',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
    'validatedAt',event->'at','validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',event->'at',
    'sortieId',coalesce(request.payload->>'sortieId',gen_random_uuid()::text));
  UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
    jsonb_build_object('action','BON_MATERIEL_SERVI','company_id',actor.company_id,'requestId',request.payload->>'id','event',event,'final',all_served,'stockDebitSource',CASE WHEN direct_debit THEN 'MAGASINIER' ELSE 'GESTIONNAIRE' END));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.inspect_stock_bon(bon_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; request jsonb; state text;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Scanner réservé au magasinier.'; END IF;
  result:=public.inspect_stock_bon_unscoped(bon_id); request:=result->'bon';
  IF NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request) THEN RAISE EXCEPTION 'Bon hors de votre bureau.'; END IF;
  state:=CASE WHEN request->>'status'='LIVREE' THEN 'DEJA_LIVRE'
    WHEN request->>'status' LIKE 'REFUS%' OR request->>'status' LIKE 'ANNUL%' THEN 'REFUSE'
    WHEN request->>'status' IN ('EN ATTENTE GESTIONNAIRE','EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') AND request#>>'{validatorDecision,approved}'='true' THEN 'VALIDE'
    ELSE 'A_VALIDER' END;
  RETURN result||jsonb_build_object('state',state,'canIssue',state='VALIDE');
END $$;

REVOKE ALL ON FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text),public.inspect_stock_bon(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text),public.inspect_stock_bon(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
