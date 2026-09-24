BEGIN;
CREATE OR REPLACE FUNCTION public.guard_stock_substocks() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor public.app_profiles; buckets jsonb; bucket text; remaining numeric; taken numeric; delta numeric;
BEGIN
 IF NEW.collection<>'stock' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.payload ? 'subStocks' AND NOT NEW.payload ? 'subStocks' THEN RAISE EXCEPTION 'La répartition en sous-stocks doit être conservée.'; END IF;
 IF current_user IN ('authenticated','anon') THEN
  IF NEW.payload ? '_substockDebit' THEN RAISE EXCEPTION 'Utilisez la confirmation du bon validé.'; END IF;
  SELECT * INTO actor FROM current_app_profile();
  IF (TG_OP='INSERT' AND NEW.payload ? 'subStocks') OR (TG_OP='UPDATE' AND NEW.payload->'subStocks' IS DISTINCT FROM OLD.payload->'subStocks') THEN RAISE EXCEPTION 'Utilisez la réorganisation des sous-stocks.'; END IF;
  IF bureau02_owns_stock(actor,NEW.payload->>'op') AND (TG_OP='INSERT' OR NEW.payload->'qty' IS DISTINCT FROM OLD.payload->'qty') THEN RAISE EXCEPTION 'Choisissez le sous-stock dans le formulaire dédié.'; END IF;
 END IF;
 -- Existing issue/transfer RPCs debit the aggregate stock. Keep its buckets in sync.
 IF TG_OP='UPDATE' AND (OLD.payload ? 'subStocks' OR NEW.payload ? '_substockDebit') AND (NEW.payload->>'qty')::numeric<(OLD.payload->>'qty')::numeric THEN
  buckets:=coalesce(OLD.payload->'subStocks','{}'::jsonb);
  delta:=(OLD.payload->>'qty')::numeric-(NEW.payload->>'qty')::numeric;remaining:=delta;
  IF NEW.payload ? '_substockDebit' THEN
   bucket:=NEW.payload->>'_substockDebit';
   IF bucket='unallocated' THEN
    IF (OLD.payload->>'qty')::numeric-(SELECT coalesce(sum(value::text::numeric),0) FROM jsonb_each(buckets))<delta THEN RAISE EXCEPTION 'Quantité insuffisante dans le stock à répartir.'; END IF;
   ELSIF bucket IN ('production','deploiement','maintenance') THEN
    IF coalesce((buckets->>bucket)::numeric,0)<delta THEN RAISE EXCEPTION 'Quantité insuffisante dans le sous-stock choisi : %',bucket; END IF;
    buckets:=jsonb_set(buckets,ARRAY[bucket],to_jsonb((buckets->>bucket)::numeric-delta));remaining:=0;
   ELSE RAISE EXCEPTION 'Sous-stock invalide.';
   END IF;
  ELSE
  FOREACH bucket IN ARRAY ARRAY['production','deploiement','maintenance'] LOOP
   taken:=least(remaining,coalesce((buckets->>bucket)::numeric,0));
   buckets:=jsonb_set(buckets,ARRAY[bucket],to_jsonb(coalesce((buckets->>bucket)::numeric,0)-taken));
   remaining:=remaining-taken;
  END LOOP;
  END IF;
  NEW.payload:=jsonb_set(NEW.payload-'_substockDebit','{subStocks}',buckets);
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,NEW.company_id,
   jsonb_build_object('action','DEBIT_SOUS_STOCKS','company_id',NEW.company_id,'stockKey',NEW.record_key,'op',NEW.payload->>'op','label',NEW.payload->>'label','qty',delta,'before',OLD.payload->'subStocks','after',buckets,'unallocatedDebit',remaining,'by',auth.uid(),'date',now()));
 END IF;
 IF NEW.payload ? 'subStocks' THEN PERFORM check_substock_quantities(NEW.payload->'subStocks',(NEW.payload->>'qty')::numeric); END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.issue_validated_request(request_key text, signature text, service text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; item record; result jsonb; sortie_key text; stock_count integer;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Sortie réservée au gestionnaire dédié.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon affecté à un autre gestionnaire.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation du validateur requise.'; END IF;
 IF length(trim(coalesce(signature,'')))=0 OR service IS NULL OR service NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Signature et service requis.'; END IF;
 -- Stable locking order prevents concurrent issues from overdrawing the same stock.
 PERFORM 1 FROM app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 FOR item IN SELECT workflow_op(coalesce(value->>'op',request.payload->>'op')) AS op,upper(trim(value->>'label')) AS label,value->>'substock' AS substock,sum((value->>'qty')::numeric) AS qty
   FROM jsonb_array_elements(request.payload->'items') GROUP BY 1,2,3 ORDER BY 1,2,3 LOOP
   IF item.qty IS NULL OR item.qty<=0 OR coalesce(actor.control_scopes->item.op,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Quantité ou stock non autorisé.'; END IF;
   SELECT count(*) INTO stock_count FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=item.op AND upper(trim(payload->>'label'))=item.label;
   IF stock_count<>1 THEN RAISE EXCEPTION 'Article absent ou ambigu : % / %',item.op,item.label; END IF;
   SELECT * INTO stockrow FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=item.op AND upper(trim(payload->>'label'))=item.label;
   IF coalesce((stockrow.payload->>'qty')::numeric,0)<item.qty THEN RAISE EXCEPTION 'Stock insuffisant : %',item.label; END IF;
   IF bureau02_owns_stock(actor,item.op) AND (item.substock IS NULL OR item.substock NOT IN ('production','deploiement','maintenance','unallocated')) THEN RAISE EXCEPTION 'Choisissez un sous-stock pour chaque matériel.'; END IF;
   UPDATE app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-item.qty)) || CASE WHEN bureau02_owns_stock(actor,item.op) THEN jsonb_build_object('_substockDebit',item.substock) ELSE '{}'::jsonb END,updated_at=now() WHERE collection='stock' AND record_key=stockrow.record_key;
 END LOOP;
 sortie_key := gen_random_uuid()::text;
 result := request.payload || jsonb_build_object('status','LIVREE','statut','LIVREE','sortieId',sortie_key,'serviceAbbreviation',service,'managerSignatureText',left(signature,500),'managerSignedAt',now(),'validatedAt',now(),'validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',now());
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES ('sorties',sortie_key,actor.company_id,result || jsonb_build_object('id',sortie_key,'sourceDemandeId',request.payload->>'id','date',now(),'tech',coalesce(request.payload->>'tech',request.payload->>'demandeurName'),'company_id',actor.company_id));
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 RETURN result;
END $$;


CREATE OR REPLACE FUNCTION public.issue_validated_request_substocks(request_key text, signature text, service text, selections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; requested jsonb; selected jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' OR coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Gestionnaire bureau 02 requis.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon hors de votre affectation.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation requise.'; END IF;
 IF jsonb_typeof(selections) IS DISTINCT FROM 'array' OR jsonb_array_length(selections)=0 THEN RAISE EXCEPTION 'Choisissez les sous-stocks.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(selections) s WHERE jsonb_typeof(s->'qty') IS DISTINCT FROM 'number' OR (s->>'qty')::numeric<=0 OR s->>'substock' IS NULL OR s->>'substock' NOT IN ('production','deploiement','maintenance','unallocated')) THEN RAISE EXCEPTION 'Sélection invalide.'; END IF;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY op,label) INTO requested FROM (SELECT workflow_op(coalesce(s->>'op',request.payload->>'op')) op,upper(trim(s->>'label')) label,sum((s->>'qty')::numeric) qty FROM jsonb_array_elements(request.payload->'items') s GROUP BY 1,2) t;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY op,label) INTO selected FROM (SELECT workflow_op(s->>'op') op,upper(trim(s->>'label')) label,sum((s->>'qty')::numeric) qty FROM jsonb_array_elements(selections) s GROUP BY 1,2) t;
 IF requested IS DISTINCT FROM selected THEN RAISE EXCEPTION 'La sélection doit correspondre exactement aux matériels et quantités du bon validé.'; END IF;
 UPDATE app_records SET payload=payload||jsonb_build_object('validatedItems',payload->'items','items',selections) WHERE collection='demandes' AND record_key=request_key;
 RETURN issue_validated_request(request_key,signature,service);
END $$;
REVOKE ALL ON FUNCTION public.issue_validated_request_substocks(text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_validated_request_substocks(text,text,text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
