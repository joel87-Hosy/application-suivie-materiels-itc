BEGIN;

CREATE OR REPLACE FUNCTION public.manager_stock_operation(
 operation_id uuid, stock_key text DEFAULT NULL, expected jsonb DEFAULT NULL, new_label text DEFAULT NULL,
 quantity numeric DEFAULT NULL, destination text DEFAULT NULL, reason text DEFAULT NULL, signature text DEFAULT NULL, service text DEFAULT NULL,
 items jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; source app_records; target app_records; result jsonb; line jsonb; item jsonb;
 before_qty numeric; after_qty numeric; target_qty numeric; movement jsonb; dest text; label text; ref text;
 duplicate_count integer; transfer boolean; is_b01_manager boolean; details jsonb:='[]'::jsonb; total_qty numeric:=0; first_before jsonb; first_after jsonb; first_key text; first_target_before numeric:=0; first_target_after numeric:=0; idx integer:=0;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Gestionnaire' OR NOT actor.is_active THEN RAISE EXCEPTION 'Operation reservee au gestionnaire actif.'; END IF;
 IF operation_id IS NULL THEN RAISE EXCEPTION 'Identifiant requis.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT payload INTO result FROM app_records WHERE collection='platformAuditLogs' AND record_key=operation_id::text;
 IF result IS NOT NULL THEN
  IF result->>'company_id' IS DISTINCT FROM actor.company_id OR result->>'by' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Operation non autorisee.'; END IF;
  RETURN result;
 END IF;
 transfer:=destination IS NOT NULL;
 IF transfer AND jsonb_typeof(items)='array' AND jsonb_array_length(items)>0 THEN
  dest:=workflow_op(destination);
  IF nullif(trim(reason),'') IS NULL OR nullif(trim(signature),'') IS NULL THEN RAISE EXCEPTION 'Motif et signature obligatoires.'; END IF;
  IF NOT coalesce(actor.control_scopes->dest='true'::jsonb OR (actor.control_scopes->'ITC-B02'='true'::jsonb AND dest IN ('ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO')),false) THEN RAISE EXCEPTION 'Stock destinataire non autorise.'; END IF;
  is_b01_manager:=coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb AND coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)<>'true'::jsonb;
  IF service IS NULL OR (is_b01_manager AND service NOT IN ('PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA')) OR (NOT is_b01_manager AND service NOT IN ('B2B','DEP','MAIN')) THEN RAISE EXCEPTION 'Service invalide.'; END IF;
  PERFORM 1 FROM app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
  FOR line IN SELECT value FROM jsonb_array_elements(items) LOOP
   idx:=idx+1; SELECT * INTO source FROM app_records WHERE collection='stock' AND record_key=line->>'stock_key' AND company_id=actor.company_id;
   item:=line->'expected';
   IF source.record_key IS NULL OR coalesce(actor.control_scopes->workflow_op(source.payload->>'op'),'false')<>'true'::jsonb THEN RAISE EXCEPTION 'Stock source hors affectation.'; END IF;
   IF (source.payload-'_dbKey') IS DISTINCT FROM (item-'_dbKey') THEN RAISE EXCEPTION 'Article modifie depuis son chargement. Actualisez puis reessayez.'; END IF;
   IF workflow_op(source.payload->>'op')=dest THEN RAISE EXCEPTION 'Le stock source et destinataire doivent differer.'; END IF;
   quantity:=(line->>'quantity')::numeric; before_qty:=(source.payload->>'qty')::numeric;
   IF quantity IS NULL OR quantity<=0 OR quantity>before_qty THEN RAISE EXCEPTION 'Quantite invalide ou stock insuffisant pour %.',source.payload->>'label'; END IF;
   label:=source.payload->>'label';
   SELECT count(*) INTO duplicate_count FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=dest AND upper(trim(payload->>'label'))=upper(trim(label));
   IF duplicate_count>1 THEN RAISE EXCEPTION 'Article ambigu dans le stock destinataire.'; END IF;
   SELECT * INTO target FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=dest AND upper(trim(payload->>'label'))=upper(trim(label));
   target_qty:=coalesce((target.payload->>'qty')::numeric,0); after_qty:=before_qty-quantity;
   IF target.record_key IS NULL THEN target.record_key:=gen_random_uuid()::text; INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock',target.record_key,actor.company_id,(source.payload-'id'-'_order'-'subStocks')||jsonb_build_object('id',target.record_key,'op',dest,'scope_key',actor.company_id||'|'||dest,'qty',quantity));
   ELSE UPDATE app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb(target_qty+quantity)),updated_at=now() WHERE collection='stock' AND record_key=target.record_key; END IF;
   UPDATE app_records SET payload=payload||jsonb_build_object('qty',after_qty),updated_at=now() WHERE collection='stock' AND record_key=source.record_key;
   ref:='TR-'||to_char(now(),'YYYYMMDD')||'-'||upper(operation_id::text);
   movement:=jsonb_build_object('company_id',actor.company_id,'op',workflow_op(source.payload->>'op'),'scope_key',actor.company_id||'|'||workflow_op(source.payload->>'op'),'date',now(),'createdAt',now(),'label',label,'qty',quantity,'delta',-quantity,'beforeQty',before_qty,'afterQty',after_qty,'type','TRANSFERT_SORTIE','sourceId',operation_id,'ref',ref,'by',actor.user_id,'byName',actor.profile->>'name','motif',trim(reason));
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text||'-out-'||idx,actor.company_id,movement||jsonb_build_object('id',operation_id::text||'-out-'||idx));
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text||'-in-'||idx,actor.company_id,movement||jsonb_build_object('id',operation_id::text||'-in-'||idx,'op',dest,'scope_key',actor.company_id||'|'||dest,'delta',quantity,'beforeQty',target_qty,'afterQty',target_qty+quantity,'type','in','movementKind','TRANSFERT_ENTREE','reference',ref));
   details:=details||jsonb_build_array(jsonb_build_object('op',workflow_op(source.payload->>'op'),'label',label,'qty',quantity,'sourceBeforeQty',before_qty,'sourceAfterQty',after_qty,'destinationBeforeQty',target_qty,'destinationAfterQty',target_qty+quantity));
   total_qty:=total_qty+quantity;
   IF idx=1 THEN first_before:=source.payload; first_after:=source.payload||jsonb_build_object('qty',after_qty); first_key:=source.record_key; first_target_before:=target_qty; first_target_after:=target_qty+quantity; END IF;
  END LOOP;
  IF idx=0 THEN RAISE EXCEPTION 'Ajoutez au moins un article.'; END IF;
  ref:='TR-'||to_char(now(),'YYYYMMDD')||'-'||upper(operation_id::text);
  result:=jsonb_build_object('id',operation_id,'company_id',actor.company_id,'action','STOCK_TRANSFER','by',actor.user_id,'byName',actor.profile->>'name','date',now(),'createdAt',now(),'op',first_before->>'op','destination',dest,'stockKey',first_key,'before',first_before,'after',first_after,'reason',trim(reason),'ref',ref,'quantity',total_qty,'items',details,'signature',trim(signature),'serviceAbbreviation',service,'destinationBeforeQty',first_target_before,'destinationAfterQty',first_target_after);
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('sorties',operation_id::text,actor.company_id,result||jsonb_build_object('type','TRANSFERT','status','LIVREE','statut','LIVREE','numBon',ref,'tech','Transfert vers '||dest,'motif',trim(reason),'items',details,'managerSignatureText',trim(signature),'managerSignedAt',now(),'validatedAt',now(),'validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',now()));
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',operation_id::text,actor.company_id,result);
  INSERT INTO app_records(collection,record_key,company_id,payload) SELECT 'notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('id',gen_random_uuid()::text,'company_id',actor.company_id,'userId',profile->'id','lu',false,'date',now(),'op',dest,'message','TRANSFERT '||ref||' vers '||dest||' ('||idx||' articles) par '||coalesce(actor.profile->>'name','Gestionnaire')||' — '||trim(reason)) FROM app_profiles WHERE company_id=actor.company_id AND is_active AND (role='Superviseur' OR (role='Gestionnaire' AND control_scopes->dest='true'::jsonb));
  RETURN result;
 END IF;
 RAISE EXCEPTION 'Arguments de transfert invalides.';
END $$;
REVOKE ALL ON FUNCTION public.manager_stock_operation(uuid,text,jsonb,text,numeric,text,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manager_stock_operation(uuid,text,jsonb,text,numeric,text,text,text,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
