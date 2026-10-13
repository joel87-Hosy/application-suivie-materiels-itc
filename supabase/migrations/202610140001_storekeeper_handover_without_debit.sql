-- Storekeeper signatures record physical handover only. The manager remains
-- responsible for the stock debit, even when handover happened first.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed_v2(
  request_key text, items jsonb, unavailable_items jsonb,
  signer_name text, signature_image text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor public.app_profiles; request public.app_records; selection jsonb; item jsonb;
  service_state jsonb; served_map jsonb; events jsonb; event_items jsonb:='[]'::jsonb;
  event jsonb; evidence jsonb; result jsonb; idx integer; qty numeric;
  served numeric; requested numeric; op text; stock_key text; all_served boolean:=true;
  i integer; manager_signed boolean; expires timestamptz;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Service réservé au magasinier.'; END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Cochez au moins un matériel à remettre.'; END IF;
  IF coalesce(jsonb_array_length(unavailable_items),0)>0 THEN RAISE EXCEPTION 'Les articles indisponibles doivent être traités avec le responsable avant la remise.'; END IF;
  IF (SELECT count(DISTINCT (value->>'index')::integer) FROM jsonb_array_elements(items))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Un matériel ne peut être sélectionné qu’une fois.'; END IF;

  SELECT * INTO request FROM public.app_records
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'status' NOT IN ('EN ATTENTE GESTIONNAIRE','EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI')
     OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true'
     OR NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN
    RAISE EXCEPTION 'Bon non validé, hors de votre bureau ou déjà entièrement servi.';
  END IF;
  expires:=public.bon_saved_timestamp(request.payload->>'bonValidUntil');
  IF expires IS NULL OR expires<=clock_timestamp() THEN RAISE EXCEPTION 'Bon expiré : confirmation du validateur rattaché requise.'; END IF;
  IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;

  manager_signed:=request.payload->>'managerSignedAt' IS NOT NULL;
  service_state:=coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
  served_map:=coalesce(service_state->'servedByItem','{}'::jsonb);
  events:=coalesce(service_state->'events','[]'::jsonb);

  FOR selection IN SELECT value FROM jsonb_array_elements(items) ORDER BY (value->>'index')::integer LOOP
    idx:=(selection->>'index')::integer;
    qty:=(selection->>'quantity')::numeric;
    IF idx<0 OR idx>=jsonb_array_length(request.payload->'items') OR qty IS NULL OR qty<=0 THEN RAISE EXCEPTION 'Sélection de matériel invalide.'; END IF;
    item:=request.payload->'items'->idx;
    requested:=(item->>'qty')::numeric;
    served:=coalesce(((served_map->idx::text)->>'qty')::numeric,0);
    IF requested IS NULL OR qty>requested-served THEN RAISE EXCEPTION 'Quantité servie supérieure au reliquat pour %.',item->>'label'; END IF;
    op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op'));
    stock_key:=coalesce(nullif(item->>'stockKey',''),nullif(item->>'_dbKey',''),
      (SELECT value->>'stockKey' FROM jsonb_array_elements(coalesce(request.payload->'managerDebitItems','[]'::jsonb)) WHERE (value->>'index')::integer=idx LIMIT 1));
    served:=served+qty;
    served_map:=jsonb_set(served_map,ARRAY[idx::text],jsonb_build_object('qty',served,'lastAt',clock_timestamp(),'stockKey',stock_key),true);
    event_items:=event_items||jsonb_build_array(jsonb_build_object('index',idx,'label',item->>'label','op',op,'qty',qty,'stockKey',stock_key));
  END LOOP;

  evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
  event:=jsonb_build_object('at',clock_timestamp(),'uid',actor.user_id,'name',actor.profile->>'name','signature',evidence,'items',event_items);
  events:=events||jsonb_build_array(event);
  FOR i IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
    item:=request.payload->'items'->i;
    requested:=(item->>'qty')::numeric;
    served:=coalesce(((served_map->i::text)->>'qty')::numeric,0);
    IF requested IS NULL OR served<requested THEN all_served:=false; END IF;
  END LOOP;

  service_state:=jsonb_build_object('servedByItem',served_map,'events',events);
  result:=request.payload||jsonb_build_object(
    'materialService',service_state,
    'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('storekeeper',evidence),
    'storekeeperHandoverPendingManager',NOT manager_signed,
    'status',CASE WHEN NOT manager_signed THEN 'EN ATTENTE GESTIONNAIRE' WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
    'statut',CASE WHEN NOT manager_signed THEN 'EN ATTENTE GESTIONNAIRE' WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END
  );
  IF manager_signed THEN
    result:=result||jsonb_build_object('validatedAt',event->'at','validatedBy',actor.profile->>'name',
      'validatedById',actor.profile->'id','dateLivraison',event->'at',
      'sortieId',coalesce(request.payload->>'sortieId',gen_random_uuid()::text));
  END IF;
  UPDATE public.app_records SET payload=result,updated_at=now()
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
    jsonb_build_object('action','BON_MATERIEL_SERVI','company_id',actor.company_id,'requestId',request.payload->>'id',
      'event',event,'final',all_served,'stockDebitSource',CASE WHEN manager_signed THEN 'GESTIONNAIRE' ELSE 'EN ATTENTE GESTIONNAIRE' END));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.inspect_stock_bon(bon_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; request jsonb; state text; expires timestamptz;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Scanner réservé au magasinier.'; END IF;
  result:=public.inspect_stock_bon_unscoped(bon_id); request:=result->'bon';
  IF NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request) THEN RAISE EXCEPTION 'Bon hors de votre bureau.'; END IF;
  expires:=public.bon_saved_timestamp(request->>'bonValidUntil');
  state:=CASE WHEN request->>'status'='LIVREE' THEN 'DEJA_LIVRE'
    WHEN request->>'status' LIKE 'REFUS%' OR request->>'status' LIKE 'ANNUL%' THEN 'REFUSE'
    WHEN expires IS NULL OR expires<=clock_timestamp() THEN 'EXPIRE'
    WHEN request->>'status' IN ('EN ATTENTE GESTIONNAIRE','EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') AND request#>>'{validatorDecision,approved}'='true' THEN 'VALIDE'
    ELSE 'A_VALIDER' END;
  RETURN result||jsonb_build_object('state',state,'canIssue',state='VALIDE');
END $$;

CREATE OR REPLACE FUNCTION public.issue_stock_request_signed(
  request_key text,signer_name text,signature_image text,service text,selections jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; request public.app_records;
        service_state jsonb; served_map jsonb; item jsonb; idx integer;
        requested numeric; served numeric; all_served boolean:=true; any_served boolean:=false;
        service_at jsonb; sortie_key text; evidence jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Signature réservée au gestionnaire affecté.'; END IF;
  IF selections IS NOT NULL THEN RAISE EXCEPTION 'La remise des articles est signée par le magasinier après débit du gestionnaire.'; END IF;
  IF coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb
     AND coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)<>'true'::jsonb THEN
    result:=public.issue_validated_request_before_validity(request_key,signer_name,service);
    evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
    result:=result||jsonb_build_object('managerSignedByUid',actor.user_id,'storekeeperHandoverPendingManager',false,
      'managerDebitAt',coalesce(result->'managerDebitAt',result->'managerSignedAt',to_jsonb(clock_timestamp())),
      'managerDebitByUid',actor.user_id,'stockDebitSource','GESTIONNAIRE',
      'bonSignatures',coalesce(result->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence));
    service_state:=coalesce(result->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
    served_map:=coalesce(service_state->'servedByItem','{}'::jsonb);
    all_served:=jsonb_typeof(result->'items')='array' AND jsonb_array_length(result->'items')>0;
    any_served:=false;
    IF all_served THEN
      FOR idx IN 0..jsonb_array_length(result->'items')-1 LOOP
        item:=result->'items'->idx;
        requested:=nullif(item->>'qty','')::numeric;
        served:=coalesce(((served_map->idx::text)->>'qty')::numeric,0);
        IF served>0 THEN any_served:=true; END IF;
        IF requested IS NULL OR served<requested THEN all_served:=false; END IF;
      END LOOP;
    END IF;
    IF any_served AND NOT all_served THEN
      result:=result||jsonb_build_object('status','PARTIELLEMENT SERVI','statut','PARTIELLEMENT SERVI');
    END IF;
    UPDATE public.app_records SET payload=result,updated_at=now()
     WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
    UPDATE public.app_records SET payload=payload||jsonb_build_object('managerSignedByUid',actor.user_id,
      'managerDebitAt',result->'managerDebitAt','managerDebitByUid',actor.user_id,'stockDebitSource','GESTIONNAIRE',
      'status',result->'status','statut',result->'statut','materialService',result->'materialService',
      'bonSignatures',coalesce(payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence)),updated_at=now()
     WHERE collection='sorties' AND company_id=actor.company_id
       AND (record_key=result->>'sortieId' OR payload->>'id'=result->>'sortieId');
    RETURN result;
  END IF;
  result:=public.issue_stock_request_signed_storekeeper(request_key,signer_name,signature_image,service,NULL);
  IF result->>'managerDebitAt' IS NULL AND result->>'status'='EN ATTENTE MAGASINIER' THEN
    result:=public.debit_manager_approved_bon(request_key,service);
  END IF;

  SELECT * INTO request FROM public.app_records
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  service_state:=coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
  served_map:=coalesce(service_state->'servedByItem','{}'::jsonb);
  IF jsonb_typeof(request.payload->'items')='array' AND jsonb_array_length(request.payload->'items')>0 THEN
    FOR idx IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
      item:=request.payload->'items'->idx;
      requested:=nullif(item->>'qty','')::numeric;
      served:=coalesce(((served_map->idx::text)->>'qty')::numeric,0);
      IF served>0 THEN any_served:=true; END IF;
      IF requested IS NULL OR served<requested THEN all_served:=false; END IF;
    END LOOP;
  END IF;

  IF all_served AND any_served THEN
    sortie_key:=coalesce(request.payload->>'sortieId',gen_random_uuid()::text);
    service_at:=service_state->'events'->-1->'at';
    result:=request.payload||jsonb_build_object('status','LIVREE','statut','LIVREE',
      'storekeeperHandoverPendingManager',false,'sortieId',sortie_key,'dateLivraison',coalesce(service_at,request.payload->'managerSignedAt'));
  ELSIF any_served THEN
    result:=request.payload||jsonb_build_object('status','PARTIELLEMENT SERVI','statut','PARTIELLEMENT SERVI',
      'storekeeperHandoverPendingManager',false);
  ELSE
    result:=request.payload||jsonb_build_object('storekeeperHandoverPendingManager',false);
  END IF;
  UPDATE public.app_records SET payload=result,updated_at=now()
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text),public.inspect_stock_bon(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text),public.inspect_stock_bon(text),public.issue_stock_request_signed(text,text,text,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
