BEGIN;
CREATE OR REPLACE FUNCTION public.bureau02_owns_stock(actor public.app_profiles, operator text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT actor.role='Gestionnaire' AND actor.is_active
 AND coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)='true'::jsonb
 AND coalesce(actor.control_scopes->workflow_op(operator),'false'::jsonb)='true'::jsonb
 AND workflow_op(operator) NOT IN ('ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO');
$$;
CREATE OR REPLACE FUNCTION public.check_substock_quantities(buckets jsonb, total numeric) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE entry record; amount numeric:=0;
BEGIN
 IF jsonb_typeof(buckets) IS DISTINCT FROM 'object' OR total IS NULL OR total<0 OR total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Répartition invalide.'; END IF;
 FOR entry IN SELECT * FROM jsonb_each(buckets) LOOP
  IF entry.key NOT IN ('production','deploiement','maintenance') OR jsonb_typeof(entry.value) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Sous-stock invalide.'; END IF;
  IF entry.value::text::numeric<0 THEN RAISE EXCEPTION 'Quantité négative interdite.'; END IF;
  amount:=amount+entry.value::text::numeric;
 END LOOP;
 IF amount>total THEN RAISE EXCEPTION 'La répartition dépasse la quantité disponible.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_stock_substocks() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor public.app_profiles; buckets jsonb; bucket text; remaining numeric; taken numeric; delta numeric;
BEGIN
 IF NEW.collection<>'stock' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.payload ? 'subStocks' AND NOT NEW.payload ? 'subStocks' THEN RAISE EXCEPTION 'La répartition en sous-stocks doit être conservée.'; END IF;
 IF current_user IN ('authenticated','anon') THEN
  SELECT * INTO actor FROM current_app_profile();
  IF (TG_OP='INSERT' AND NEW.payload ? 'subStocks') OR (TG_OP='UPDATE' AND NEW.payload->'subStocks' IS DISTINCT FROM OLD.payload->'subStocks') THEN RAISE EXCEPTION 'Utilisez la réorganisation des sous-stocks.'; END IF;
  IF bureau02_owns_stock(actor,NEW.payload->>'op') AND (TG_OP='INSERT' OR NEW.payload->'qty' IS DISTINCT FROM OLD.payload->'qty') THEN RAISE EXCEPTION 'Choisissez le sous-stock dans le formulaire dédié.'; END IF;
 END IF;
 -- Existing issue/transfer RPCs debit the aggregate stock. Keep its buckets in sync.
 IF TG_OP='UPDATE' AND OLD.payload ? 'subStocks' AND (NEW.payload->>'qty')::numeric<(OLD.payload->>'qty')::numeric THEN
  buckets:=OLD.payload->'subStocks';
  delta:=(OLD.payload->>'qty')::numeric-(NEW.payload->>'qty')::numeric;remaining:=delta;
  FOREACH bucket IN ARRAY ARRAY['production','deploiement','maintenance'] LOOP
   taken:=least(remaining,coalesce((buckets->>bucket)::numeric,0));
   buckets:=jsonb_set(buckets,ARRAY[bucket],to_jsonb(coalesce((buckets->>bucket)::numeric,0)-taken));
   remaining:=remaining-taken;
  END LOOP;
  NEW.payload:=jsonb_set(NEW.payload,'{subStocks}',buckets);
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,NEW.company_id,
   jsonb_build_object('action','DEBIT_SOUS_STOCKS','company_id',NEW.company_id,'stockKey',NEW.record_key,'op',NEW.payload->>'op','label',NEW.payload->>'label','qty',delta,'before',OLD.payload->'subStocks','after',buckets,'unallocatedDebit',remaining,'by',auth.uid(),'date',now()));
 END IF;
 IF NEW.payload ? 'subStocks' THEN PERFORM check_substock_quantities(NEW.payload->'subStocks',(NEW.payload->>'qty')::numeric); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_stock_substocks ON public.app_records;
CREATE TRIGGER guard_stock_substocks BEFORE INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_stock_substocks();

CREATE OR REPLACE FUNCTION public.reorganize_stock_substocks(stock_key text, expected jsonb, buckets jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; item public.app_records; result jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT * INTO item FROM app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR UPDATE;
 IF item.record_key IS NULL OR NOT coalesce(bureau02_owns_stock(actor,item.payload->>'op'),false) THEN RAISE EXCEPTION 'Sous-stocks réservés au gestionnaire bureau 02 sur ses stocks dédiés.'; END IF;
 IF (item.payload-'_dbKey') IS DISTINCT FROM (expected-'_dbKey') THEN RAISE EXCEPTION 'Stock modifié. Actualisez puis réessayez.'; END IF;
 PERFORM check_substock_quantities(buckets,(item.payload->>'qty')::numeric);
 result:=item.payload||jsonb_build_object('subStocks',buckets);
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='stock' AND record_key=stock_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','REORGANISATION_SOUS_STOCKS','by',actor.user_id,'company_id',actor.company_id,'stockKey',stock_key,'before',item.payload,'after',result,'date',now()));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.receive_stock_substock(operation_id uuid, operator text, material_label text, material_type text, quantity numeric, substock text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; item public.app_records; result jsonb; buckets jsonb; matches integer;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF NOT coalesce(bureau02_owns_stock(actor,operator),false) THEN RAISE EXCEPTION 'Stock hors de votre affectation bureau 02.'; END IF;
 IF operation_id IS NULL OR substock IS NULL OR substock NOT IN ('production','deploiement','maintenance') OR quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity') OR quantity<>trunc(quantity) OR nullif(trim(material_label),'') IS NULL OR nullif(trim(material_type),'') IS NULL THEN RAISE EXCEPTION 'Article, quantité entière positive et sous-stock requis.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT payload INTO result FROM app_records WHERE collection='stockMovements' AND record_key=operation_id::text;
 IF result IS NOT NULL THEN
  IF result->>'actorUid' IS DISTINCT FROM actor.user_id::text OR result->>'company_id' IS DISTINCT FROM actor.company_id OR result->>'op' IS DISTINCT FROM workflow_op(operator) OR result->>'substock' IS DISTINCT FROM substock OR (result->>'qty')::numeric IS DISTINCT FROM quantity THEN RAISE EXCEPTION 'Opération non autorisée.'; END IF;
  RETURN result;
 END IF;
 SELECT count(*) INTO matches FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=workflow_op(operator) AND upper(regexp_replace(trim(payload->>'label'),'\s+',' ','g'))=upper(regexp_replace(trim(material_label),'\s+',' ','g'));
 IF matches>1 THEN RAISE EXCEPTION 'Article ambigu. Réorganisez les fiches en double.'; END IF;
 SELECT * INTO item FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=workflow_op(operator) AND upper(regexp_replace(trim(payload->>'label'),'\s+',' ','g'))=upper(regexp_replace(trim(material_label),'\s+',' ','g')) FOR UPDATE;
 buckets:=coalesce(item.payload->'subStocks','{}'::jsonb);
 buckets:=jsonb_set(buckets,ARRAY[substock],to_jsonb(coalesce((buckets->>substock)::numeric,0)+quantity));
 result:=coalesce(item.payload,jsonb_build_object('company_id',actor.company_id,'op',workflow_op(operator),'label',trim(material_label),'type',trim(material_type)))||jsonb_build_object('qty',coalesce((item.payload->>'qty')::numeric,0)+quantity,'subStocks',buckets);
 item.record_key:=coalesce(item.record_key,gen_random_uuid()::text);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock',item.record_key,actor.company_id,result) ON CONFLICT(collection,record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now();
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text,actor.company_id,jsonb_build_object('id',operation_id,'company_id',actor.company_id,'op',workflow_op(operator),'label',result->>'label','qty',quantity,'type','in','source','reception','substock',substock,'stockKey',item.record_key,'actorUid',actor.user_id,'createdAt',now(),'reference',operation_id));
 INSERT INTO app_records(collection,record_key,company_id,payload)
 SELECT 'notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'userId',profile->'id','lu',false,'date',now(),'createdAt',now(),'section','trafic-audit','message','ENTRÉE STOCK : '||(result->>'label')||' — '||quantity||' — '||workflow_op(operator)||' / '||substock)
 FROM app_profiles WHERE company_id=actor.company_id AND is_active AND role IN ('Superviseur','DG');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reorganize_stock_substocks(text,jsonb,jsonb),public.receive_stock_substock(uuid,text,text,text,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reorganize_stock_substocks(text,jsonb,jsonb),public.receive_stock_substock(uuid,text,text,text,numeric,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.manager_stock_operation(
 operation_id uuid, stock_key text, expected jsonb, new_label text,
 quantity numeric, destination text, reason text, signature text, service text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; source app_records; target app_records; result jsonb;
 before_qty numeric; after_qty numeric; target_qty numeric; movement jsonb;
 dest text; label text; ref text; duplicate_count integer; transfer boolean;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Gestionnaire' OR NOT actor.is_active THEN
  RAISE EXCEPTION 'Opération réservée au gestionnaire actif.';
 END IF;
 IF operation_id IS NULL THEN RAISE EXCEPTION 'Identifiant requis.'; END IF;
 -- Serialize retries and concurrent transfers, including creation of a destination article.
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT payload INTO result FROM app_records WHERE collection='platformAuditLogs' AND record_key=operation_id::text;
 IF result IS NOT NULL THEN
  IF result->>'company_id' IS DISTINCT FROM actor.company_id OR result->>'by' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Opération non autorisée.'; END IF;
  RETURN result;
 END IF;
 IF quantity IS NULL OR quantity::text IN ('NaN','Infinity','-Infinity') OR quantity<0 THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
 IF nullif(trim(reason),'') IS NULL THEN RAISE EXCEPTION 'Motif obligatoire.'; END IF;
 PERFORM 1 FROM app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 SELECT * INTO source FROM app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id;
 IF source.record_key IS NULL OR coalesce(actor.control_scopes->workflow_op(source.payload->>'op'),'false')<>'true'::jsonb THEN RAISE EXCEPTION 'Stock hors de votre affectation.'; END IF;
 IF (source.payload-'_dbKey') IS DISTINCT FROM (expected-'_dbKey') THEN RAISE EXCEPTION 'Article modifié depuis son chargement. Actualisez puis réessayez.'; END IF;
 before_qty:=(source.payload->>'qty')::numeric;
 transfer:=destination IS NOT NULL;
 label:=upper(trim(coalesce(new_label,source.payload->>'label')));
 IF nullif(label,'') IS NULL THEN RAISE EXCEPTION 'Nom obligatoire.'; END IF;
 IF transfer THEN
  dest:=workflow_op(destination);
  IF dest=workflow_op(source.payload->>'op') OR NOT coalesce(
    actor.control_scopes->dest='true'::jsonb OR
    (actor.control_scopes->'ITC-B02'='true'::jsonb AND dest IN ('ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO')),false
  ) THEN RAISE EXCEPTION 'Stock destinataire non autorisé.'; END IF;
  IF quantity<=0 OR quantity>before_qty THEN RAISE EXCEPTION 'Quantité supérieure au stock disponible ou invalide.'; END IF;
  IF nullif(trim(signature),'') IS NULL OR service IS NULL OR service NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Signature et service requis.'; END IF;
  label:=source.payload->>'label';
  SELECT count(*) INTO duplicate_count FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=dest AND upper(trim(payload->>'label'))=upper(trim(label));
  IF duplicate_count>1 THEN RAISE EXCEPTION 'Article ambigu dans le stock destinataire.'; END IF;
  SELECT * INTO target FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=dest AND upper(trim(payload->>'label'))=upper(trim(label));
  target_qty:=coalesce((target.payload->>'qty')::numeric,0);
  IF target.record_key IS NULL THEN
   target.record_key:=gen_random_uuid()::text;
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock',target.record_key,actor.company_id,
    (source.payload-'id'-'_order'-'subStocks')||jsonb_build_object('id',target.record_key,'op',dest,'scope_key',actor.company_id||'|'||dest,'qty',quantity));
  ELSE
   UPDATE app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb(target_qty+quantity)),updated_at=now() WHERE collection='stock' AND record_key=target.record_key;
  END IF;
  after_qty:=before_qty-quantity;
 ELSE
  IF EXISTS(SELECT 1 FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND record_key<>stock_key AND workflow_op(payload->>'op')=workflow_op(source.payload->>'op') AND upper(trim(payload->>'label'))=label) THEN RAISE EXCEPTION 'Un article porte déjà ce nom dans ce stock.'; END IF;
  after_qty:=quantity;
 END IF;
 UPDATE app_records SET payload=payload||jsonb_build_object('label',label,'qty',after_qty),updated_at=now() WHERE collection='stock' AND record_key=stock_key;
 ref:='TR-'||to_char(now(),'YYYYMMDD')||'-'||upper(operation_id::text);
 result:=jsonb_build_object('id',operation_id,'company_id',actor.company_id,'action',CASE WHEN transfer THEN 'STOCK_TRANSFER' ELSE 'STOCK_CORRECTION' END,
  'by',actor.user_id,'byName',actor.profile->>'name','date',now(),'createdAt',now(),'op',workflow_op(source.payload->>'op'),'destination',dest,
  'stockKey',stock_key,'before',source.payload,'after',(SELECT payload FROM app_records WHERE collection='stock' AND record_key=stock_key),'reason',trim(reason),'ref',ref);
 movement:=jsonb_build_object('company_id',actor.company_id,'op',workflow_op(source.payload->>'op'),'scope_key',actor.company_id||'|'||workflow_op(source.payload->>'op'),
  'date',now(),'createdAt',now(),'label',label,'qty',abs(after_qty-before_qty),'delta',after_qty-before_qty,'beforeQty',before_qty,'afterQty',after_qty,
  'type',CASE WHEN transfer THEN 'TRANSFERT_SORTIE' ELSE 'CORRECTION' END,'sourceId',operation_id,'ref',ref,'by',actor.user_id,'byName',actor.profile->>'name','motif',trim(reason));
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text||'-out',actor.company_id,movement||jsonb_build_object('id',operation_id::text||'-out'));
 IF transfer THEN
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text||'-in',actor.company_id,
   movement||jsonb_build_object('id',operation_id::text||'-in','op',dest,'scope_key',actor.company_id||'|'||dest,'delta',quantity,'beforeQty',target_qty,'afterQty',target_qty+quantity,'type','in','movementKind','TRANSFERT_ENTREE','reference',ref));
  result:=result||jsonb_build_object('destinationBeforeQty',target_qty,'destinationAfterQty',target_qty+quantity,'quantity',quantity,'signature',trim(signature),'serviceAbbreviation',service);
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('sorties',operation_id::text,actor.company_id,
   result||jsonb_build_object('type','TRANSFERT','status','LIVREE','statut','LIVREE','numBon',ref,'tech','Transfert vers '||dest,'motif',trim(reason),
    'items',jsonb_build_array(jsonb_build_object('op',workflow_op(source.payload->>'op'),'label',label,'qty',quantity)),
    'managerSignatureText',trim(signature),'managerSignedAt',now(),'validatedAt',now(),'validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',now()));
 END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',operation_id::text,actor.company_id,result);
 INSERT INTO app_records(collection,record_key,company_id,payload)
 SELECT 'notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('id',gen_random_uuid()::text,'company_id',actor.company_id,'userId',profile->'id','lu',false,'date',now(),'op',source.payload->>'op','message',
  CASE WHEN transfer THEN 'TRANSFERT '||ref ELSE 'CORRECTION STOCK' END||' : '||label||' par '||coalesce(actor.profile->>'name','Gestionnaire')||' — '||trim(reason))
 FROM app_profiles WHERE company_id=actor.company_id AND is_active AND (role='Superviseur' OR (transfer AND role='Gestionnaire' AND control_scopes->dest='true'::jsonb));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.manager_stock_operation(uuid,text,jsonb,text,numeric,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manager_stock_operation(uuid,text,jsonb,text,numeric,text,text,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
