BEGIN;

-- Finalise a partially issued request when the remaining lines are unavailable.
-- Stock deductions and signature are handled atomically by the existing RPC.
CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed_v2(
  request_key text, items jsonb, unavailable_items jsonb,
  signer_name text, signature_image text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result jsonb; request public.app_records; service_state jsonb;
        unavailable_map jsonb; idx integer; item jsonb; requested numeric; served numeric;
        i integer; all_resolved boolean:=true; stock_available numeric; selected_qty numeric;
        evidence jsonb; event jsonb; events jsonb; event_items jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Sortie réservée au magasinier.'; END IF;
  IF jsonb_typeof(unavailable_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Liste des indisponibilités invalide.'; END IF;
  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'status' NOT IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') THEN RAISE EXCEPTION 'Bon non autorisé.'; END IF;
  service_state:=coalesce(request.payload->'materialService','{}'::jsonb);
  unavailable_map:=coalesce(service_state->'unavailableByItem','{}'::jsonb);
  FOR idx IN SELECT value::integer FROM jsonb_array_elements_text(unavailable_items) LOOP
    IF idx<0 OR idx>=jsonb_array_length(request.payload->'items') THEN RAISE EXCEPTION 'Article indisponible invalide.'; END IF;
    item:=request.payload->'items'->idx;
    SELECT coalesce(sum((s.payload->>'qty')::numeric),0) INTO stock_available FROM public.app_records s WHERE s.collection='stock' AND s.company_id=actor.company_id
      AND public.workflow_op(coalesce(s.payload->>'op',s.payload->>'operator'))=public.workflow_op(coalesce(item->>'op',request.payload->>'op'))
      AND upper(regexp_replace(trim(coalesce(s.payload->>'label',s.payload->>'name',s.payload->>'designation')),'[[:space:]]+',' ','g'))
        =upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g'))
      AND coalesce((s.payload->>'qty')::numeric,0)>0;
    SELECT coalesce(sum((x->>'quantity')::numeric),0) INTO selected_qty FROM jsonb_array_elements(items) x WHERE (x->>'index')::integer=idx;
    IF stock_available>selected_qty THEN RAISE EXCEPTION 'Le matériel % existe encore en stock; servez-le avant de le marquer indisponible.',item->>'label'; END IF;
    unavailable_map:=jsonb_set(unavailable_map,ARRAY[idx::text],jsonb_build_object('at',clock_timestamp(),'by',actor.user_id,'reason','ABSENT_DU_STOCK'),true);
  END LOOP;
  IF jsonb_array_length(items)>0 THEN
    result:=public.dispense_stock_bon_signed(request_key,items,signer_name,signature_image);
  ELSE
    evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
    events:=coalesce(service_state->'events','[]'::jsonb);
    event:=jsonb_build_object('at',clock_timestamp(),'uid',actor.user_id,'name',actor.profile->>'name','signature',evidence,'items',event_items);
    events:=events||jsonb_build_array(event);
    result:=request.payload||jsonb_build_object('materialService',service_state||jsonb_build_object('servedByItem',coalesce(service_state->'servedByItem','{}'::jsonb),'unavailableByItem',unavailable_map,'events',events),
      'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('storekeeper',evidence),
      'status','LIVREE','statut','LIVREE','validatedAt',event->'at','validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',event->'at');
    UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
    INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
      jsonb_build_object('action','BON_MATERIEL_INDISPONIBLE','company_id',actor.company_id,'requestId',request.payload->>'id','event',event,'final',true));
    RETURN result;
  END IF;
  SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  service_state:=coalesce(request.payload->'materialService','{}'::jsonb)||jsonb_build_object('unavailableByItem',unavailable_map);
  FOR i IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
    item:=request.payload->'items'->i; requested:=(item->>'qty')::numeric;
    served:=coalesce(((service_state->'servedByItem'->i::text)->>'qty')::numeric,0);
    IF served<requested AND NOT (unavailable_map ? i::text) THEN all_resolved:=false; END IF;
  END LOOP;
  IF all_resolved THEN
    request.payload:=request.payload||jsonb_build_object('materialService',service_state,'status','LIVREE','statut','LIVREE');
    UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  END IF;
  RETURN request.payload;
END $$;

REVOKE ALL ON FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispense_stock_bon_signed_v2(text,jsonb,jsonb,text,text) TO authenticated;
COMMIT;
