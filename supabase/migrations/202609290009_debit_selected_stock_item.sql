-- Carry the exact stock row chosen in the Bureau 01 physical-issue form through
-- approval and debit. Service codes remain specific to the single-scope B01 manager.
BEGIN;
CREATE OR REPLACE FUNCTION public.issue_validated_request_before_validity(request_key text, signature text, service text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; item record; result jsonb; sortie_key text; stock_count integer; label_key text; is_b01_manager boolean;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Sortie réservée au gestionnaire dédié.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon affecté à un autre gestionnaire.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation du validateur requise.'; END IF;
 is_b01_manager:=coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb AND coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)<>'true'::jsonb;
 IF length(trim(coalesce(signature,'')))=0 OR service IS NULL OR length(trim(service))=0 THEN RAISE EXCEPTION 'Signature et service requis.'; END IF;
 IF is_b01_manager AND service NOT IN ('PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA') THEN RAISE EXCEPTION 'Service émetteur invalide pour le gestionnaire Bureau 01.'; END IF;
 IF NOT is_b01_manager AND service NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Service émetteur invalide pour ce gestionnaire.'; END IF;
 PERFORM 1 FROM app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 FOR item IN
  SELECT workflow_op(coalesce(value->>'op',request.payload->>'op')) AS op,
         upper(regexp_replace(replace(replace(replace(replace(trim(value->>'label'),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g')) AS label,
         coalesce(value->>'stockKey','') AS stock_key,value->>'substock' AS substock,
         sum((value->>'qty')::numeric) AS qty
  FROM jsonb_array_elements(request.payload->'items') GROUP BY 1,2,3,4 ORDER BY 1,2,3,4
 LOOP
  IF item.qty IS NULL OR item.qty<=0 OR coalesce(actor.control_scopes->item.op,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Quantité ou stock non autorisé.'; END IF;
  label_key:=upper(regexp_replace(replace(replace(replace(replace(trim(item.label),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'));
  stock_count:=0;
  IF item.stock_key<>'' THEN
   SELECT * INTO stockrow FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND record_key=item.stock_key FOR UPDATE;
   IF stockrow.record_key IS NOT NULL
     AND workflow_op(coalesce(stockrow.payload->>'op',stockrow.payload->>'operator'))=item.op
     AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(stockrow.payload->>'label',stockrow.payload->>'name',stockrow.payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key THEN stock_count:=1; END IF;
  ELSIF is_b01_manager AND item.op='ITC-B01' THEN
   SELECT count(*) INTO stock_count FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND payload->>'op'='ITC-B01'
    AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key;
   IF stock_count=1 THEN
    SELECT * INTO stockrow FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND payload->>'op'='ITC-B01'
     AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key FOR UPDATE;
   END IF;
  ELSE
   SELECT count(*) INTO stock_count FROM app_records WHERE collection='stock' AND company_id=actor.company_id
    AND workflow_op(coalesce(payload->>'op',payload->>'operator'))=item.op
    AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key;
   IF stock_count=1 THEN SELECT * INTO stockrow FROM app_records WHERE collection='stock' AND company_id=actor.company_id
    AND workflow_op(coalesce(payload->>'op',payload->>'operator'))=item.op
    AND upper(regexp_replace(replace(replace(replace(replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),chr(160),' '),chr(8203),''),chr(8204),''),chr(8205),''),'[[:space:]]+',' ','g'))=label_key FOR UPDATE; END IF;
  END IF;
  IF stock_count<>1 THEN RAISE EXCEPTION 'Article absent ou ambigu dans le stock sélectionné : % / % (correspondances : %).',item.op,item.label,stock_count; END IF;
  IF coalesce((stockrow.payload->>'qty')::numeric,0)<item.qty THEN RAISE EXCEPTION 'Stock insuffisant : % (disponible : %, demandé : %).',item.label,coalesce(stockrow.payload->>'qty','0'),item.qty; END IF;
  IF coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)='true' AND item.substock IS NOT NULL AND item.substock NOT IN ('production','deploiement','maintenance','unallocated') THEN RAISE EXCEPTION 'Sous-stock invalide.'; END IF;
  UPDATE app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-item.qty)) || CASE WHEN coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)='true' AND item.substock IS NOT NULL THEN jsonb_build_object('_substockDebit',item.substock) ELSE '{}'::jsonb END,updated_at=now()
   WHERE collection='stock' AND record_key=stockrow.record_key;
 END LOOP;
 sortie_key:=gen_random_uuid()::text;
 result:=request.payload||jsonb_build_object('status','LIVREE','statut','LIVREE','sortieId',sortie_key,'serviceAbbreviation',service,'managerSignatureText',left(signature,500),'managerSignedAt',now(),'validatedAt',now(),'validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',now());
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('sorties',sortie_key,actor.company_id,result||jsonb_build_object('id',sortie_key,'sourceDemandeId',request.payload->>'id','date',now(),'tech',coalesce(request.payload->>'tech',request.payload->>'demandeurName'),'company_id',actor.company_id));
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.issue_validated_request_before_validity(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_validated_request_before_validity(text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
