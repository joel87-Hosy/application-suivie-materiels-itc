BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.cancel_storekeeper_pending_bon(
  request_key text,
  expected_bon_id text,
  expected_manager_debit_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor public.app_profiles;
  request public.app_records;
  stockrow public.app_records;
  item jsonb;
  debit jsonb;
  service_state jsonb;
  served_map jsonb;
  buckets jsonb;
  restored_items jsonb:='[]'::jsonb;
  result jsonb;
  idx integer;
  item_count integer;
  debit_count integer;
  distinct_debit_count integer;
  op text;
  item_label text;
  stock_key text;
  substock text;
  debited numeric;
  served numeric;
  restore_qty numeric;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.role IS DISTINCT FROM 'Magasinier' OR actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Action réservée au magasinier.';
  END IF;

  SELECT * INTO request FROM public.app_records
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id
   FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'id' IS DISTINCT FROM expected_bon_id THEN
    RAISE EXCEPTION 'Bon absent ou modifié. Actualisez la liste.';
  END IF;
  IF nullif(request.payload->>'managerDebitAt','')::timestamptz IS DISTINCT FROM expected_manager_debit_at THEN
    RAISE EXCEPTION 'Le débit du bon a changé. Actualisez la liste.';
  END IF;
  IF NOT public.storekeeper_covers_request(actor.profile,actor.control_scopes,actor.company_id,request.payload) THEN
    RAISE EXCEPTION 'Bon hors de votre bureau.';
  END IF;
  IF request.payload->>'status' NOT IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI')
     OR request.payload->>'managerSignedAt' IS NULL
     OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true'
     OR request.payload->'storekeeperCancellation' IS NOT NULL THEN
    RAISE EXCEPTION 'Ce bon n’est plus en attente de régularisation.';
  END IF;

  item_count:=jsonb_array_length(coalesce(request.payload->'items','[]'::jsonb));
  IF item_count=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;
  service_state:=coalesce(request.payload->'materialService','{}'::jsonb);
  served_map:=coalesce(service_state->'servedByItem','{}'::jsonb);

  IF request.payload->>'managerDebitAt' IS NOT NULL THEN
    IF jsonb_typeof(request.payload->'managerDebitItems') IS DISTINCT FROM 'array'
       OR jsonb_array_length(request.payload->'managerDebitItems')<>item_count THEN
      RAISE EXCEPTION 'Le détail du débit gestionnaire est incomplet; annulation sécurisée impossible.';
    END IF;
    SELECT count(*) INTO debit_count
      FROM jsonb_array_elements(request.payload->'managerDebitItems') AS d(value)
     WHERE nullif(d.value->>'index','') IS NOT NULL;
    SELECT count(DISTINCT (d.value->>'index')::integer) INTO distinct_debit_count
      FROM jsonb_array_elements(request.payload->'managerDebitItems') AS d(value);
    IF debit_count<>item_count OR distinct_debit_count<>item_count THEN
      RAISE EXCEPTION 'Le détail du débit gestionnaire est invalide.';
    END IF;

    PERFORM 1 FROM public.app_records s
     WHERE s.collection='stock' AND s.company_id=actor.company_id
       AND s.record_key IN (
         SELECT value->>'stockKey'
           FROM jsonb_array_elements(request.payload->'managerDebitItems')
          WHERE nullif(value->>'stockKey','') IS NOT NULL
       )
     ORDER BY s.record_key FOR UPDATE;

    FOR idx IN 0..item_count-1 LOOP
      item:=request.payload->'items'->idx;
      SELECT d.value INTO debit
        FROM jsonb_array_elements(request.payload->'managerDebitItems') AS d(value)
       WHERE (d.value->>'index')::integer=idx;
      IF debit IS NULL THEN RAISE EXCEPTION 'Débit introuvable pour l’article %.',idx+1; END IF;

      debited:=nullif(debit->>'qty','')::numeric;
      IF debited IS DISTINCT FROM nullif(item->>'qty','')::numeric THEN
        RAISE EXCEPTION 'Quantité débitée incohérente pour l’article %.',idx+1;
      END IF;
      served:=coalesce(nullif((served_map->(idx::text))->>'qty','')::numeric,0);
      IF debited IS NULL OR debited<=0 OR served<0 OR served>debited THEN
        RAISE EXCEPTION 'Quantités de débit ou de remise invalides pour l’article %.',idx+1;
      END IF;
      restore_qty:=debited-served;
      IF restore_qty=0 THEN CONTINUE; END IF;

      stock_key:=nullif(debit->>'stockKey','');
      op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op'));
      item_label:=coalesce(item->>'label','');
      substock:=nullif(debit->>'substock','');
      IF stock_key IS NULL THEN RAISE EXCEPTION 'Stock d’origine manquant pour l’article %.',item_label; END IF;

      SELECT * INTO stockrow FROM public.app_records
       WHERE collection='stock' AND company_id=actor.company_id AND record_key=stock_key
       FOR UPDATE;
      IF stockrow.record_key IS NULL
         OR public.workflow_op(coalesce(stockrow.payload->>'op',stockrow.payload->>'operator')) IS DISTINCT FROM op
         OR upper(regexp_replace(trim(coalesce(stockrow.payload->>'label',stockrow.payload->>'name',stockrow.payload->>'designation')),'[[:space:]]+',' ','g'))
            IS DISTINCT FROM upper(regexp_replace(trim(item_label),'[[:space:]]+',' ','g')) THEN
        RAISE EXCEPTION 'Stock d’origine introuvable ou modifié pour l’article %.',item_label;
      END IF;

      buckets:=stockrow.payload->'subStocks';
      IF jsonb_typeof(buckets)='object' AND buckets<>'{}'::jsonb AND substock IS NULL THEN
        RAISE EXCEPTION 'La répartition du débit dans les sous-stocks est inconnue pour %; contactez un responsable avant l’annulation.',item_label;
      END IF;
      IF jsonb_typeof(buckets)='object' AND substock IS NOT NULL AND substock<>'unallocated' THEN
        IF NOT (buckets ? substock) THEN RAISE EXCEPTION 'Sous-stock d’origine introuvable pour l’article %.',item_label; END IF;
        buckets:=jsonb_set(buckets,ARRAY[substock],to_jsonb(coalesce(nullif(buckets->>substock,'')::numeric,0)+restore_qty),true);
      END IF;

      IF jsonb_typeof(buckets)='object' THEN
        UPDATE public.app_records
           SET payload=jsonb_set(jsonb_set(payload,'{qty}',to_jsonb(coalesce(nullif(payload->>'qty','')::numeric,0)+restore_qty),true),'{subStocks}',buckets,true),
               updated_at=now()
         WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id;
      ELSE
        UPDATE public.app_records
           SET payload=jsonb_set(payload,'{qty}',to_jsonb(coalesce(nullif(payload->>'qty','')::numeric,0)+restore_qty),true),
               updated_at=now()
         WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id;
      END IF;

      INSERT INTO public.app_records(collection,record_key,company_id,payload)
      VALUES('stockMovements',gen_random_uuid()::text,actor.company_id,
        jsonb_build_object('company_id',actor.company_id,'op',op,'label',item_label,'qty',restore_qty,
          'type','in','source','storekeeper_bon_cancellation','stockKey',stock_key,
          'actorUid',actor.user_id,'createdAt',clock_timestamp(),'reference',request.payload->>'id'));
      restored_items:=restored_items||jsonb_build_array(jsonb_build_object(
        'index',idx,'stockKey',stock_key,'op',op,'label',item_label,'qty',restore_qty,'substock',substock));
    END LOOP;
  END IF;

  result:=request.payload||jsonb_build_object(
    'status','ANNULEE MAGASINIER',
    'statut','ANNULEE MAGASINIER',
    'storekeeperCancellation',jsonb_build_object(
      'uid',actor.user_id,'name',actor.profile->>'name','at',clock_timestamp(),'restoredItems',restored_items));
  UPDATE public.app_records SET payload=result,updated_at=now()
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  INSERT INTO public.app_records(collection,record_key,company_id,payload)
  VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
    jsonb_build_object('action','ANNULATION_BON_MAGASINIER','company_id',actor.company_id,
      'requestId',request.payload->>'id','requestKey',request_key,'by',actor.user_id,
      'name',actor.profile->>'name','at',clock_timestamp(),'restoredItems',restored_items,'before',request.payload));
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.cancel_storekeeper_pending_bon(text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_storekeeper_pending_bon(text,text,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
