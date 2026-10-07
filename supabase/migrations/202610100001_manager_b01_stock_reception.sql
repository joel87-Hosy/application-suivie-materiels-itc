BEGIN;

CREATE OR REPLACE FUNCTION public.receive_manager_b01_stock_item(
 operation_id uuid, stock_op text, material_label text, material_type text, quantity numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; item app_records; prior jsonb; result jsonb;
 label text; before_qty numeric; item_key text;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR NOT manager_b01_owns_stock(actor,stock_op) THEN
  RAISE EXCEPTION 'Stock hors de votre affectation Bureau 01.';
 END IF;
 label:=upper(regexp_replace(trim(coalesce(material_label,'')),'\s+',' ','g'));
 IF operation_id IS NULL OR nullif(label,'') IS NULL OR length(label)>200 OR
    nullif(trim(coalesce(material_type,'')),'') IS NULL OR length(trim(material_type))>100 OR
    quantity IS NULL OR quantity<=0 OR quantity<>trunc(quantity) OR quantity>9007199254740991 OR
    quantity::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'Article, type et quantité entière positive valides requis.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id||'|'||workflow_op(stock_op)));
 SELECT payload INTO prior FROM app_records WHERE collection='stockMovements' AND record_key=operation_id::text;
 IF FOUND THEN
  IF prior->>'actorUid' IS DISTINCT FROM actor.user_id::text OR prior->>'company_id' IS DISTINCT FROM actor.company_id OR
     prior->>'op' IS DISTINCT FROM workflow_op(stock_op) OR (prior->>'qty')::numeric IS DISTINCT FROM quantity THEN
   RAISE EXCEPTION 'Identifiant de réception déjà utilisé.';
  END IF;
  RETURN prior;
 END IF;
 IF (SELECT count(*) FROM app_records WHERE collection='stock' AND company_id=actor.company_id
   AND workflow_op(payload->>'op')=workflow_op(stock_op)
   AND upper(regexp_replace(trim(payload->>'label'),'\s+',' ','g'))=label)>1 THEN
  RAISE EXCEPTION 'Article ambigu dans ce stock. Faites vérifier les fiches en double.';
 END IF;
 SELECT * INTO item FROM app_records WHERE collection='stock' AND company_id=actor.company_id
   AND workflow_op(payload->>'op')=workflow_op(stock_op)
   AND upper(regexp_replace(trim(payload->>'label'),'\s+',' ','g'))=label FOR UPDATE;
 before_qty:=coalesce((item.payload->>'qty')::numeric,0);
 IF before_qty<0 OR before_qty+quantity>9007199254740991 THEN RAISE EXCEPTION 'Quantité totale invalide.'; END IF;
 IF item.record_key IS NOT NULL AND item.payload->>'type' IS DISTINCT FROM trim(material_type) THEN
  RAISE EXCEPTION 'Cet article existe avec un autre type de matériel.';
 END IF;
 item_key:=coalesce(item.record_key,gen_random_uuid()::text);
 result:=coalesce(item.payload,'{}'::jsonb)||jsonb_build_object('id',item_key,'company_id',actor.company_id,
   'op',workflow_op(stock_op),'scope_key',actor.company_id||'|'||workflow_op(stock_op),
   'label',coalesce(item.payload->>'label',label),'type',coalesce(item.payload->>'type',trim(material_type)),
   'qty',before_qty+quantity);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock',item_key,actor.company_id,result)
 ON CONFLICT(collection,record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now();
 result:=jsonb_build_object('id',operation_id,'company_id',actor.company_id,'op',workflow_op(stock_op),
   'label',result->>'label','materialType',result->>'type','qty',quantity,'beforeQty',before_qty,
   'afterQty',before_qty+quantity,'type','in','source','reception','stockKey',item_key,
   'actorUid',actor.user_id,'byName',actor.profile->>'name','createdAt',now(),'reference',operation_id);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text,actor.company_id,result);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,
   actor.company_id,result||jsonb_build_object('action','RECEIVE_MANAGER_B01_STOCK_ITEM'));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.receive_manager_b01_stock_item(uuid,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_manager_b01_stock_item(uuid,text,text,text,numeric) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
