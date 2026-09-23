BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Bureau 02 supplies regional warehouses, but is not their inventory manager.
-- Repair mixed assignments without touching inventory quantities.
WITH previous AS MATERIALIZED (
 SELECT * FROM app_profiles WHERE role='Gestionnaire' AND control_scopes->'ITC-B02'='true'::jsonb
 AND control_scopes ?| ARRAY['ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO']
), repaired AS (
 UPDATE app_profiles p SET
 control_scopes=p.control_scopes-ARRAY['ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO'],
 control_scope_keys=p.control_scope_keys-ARRAY[p.company_id||'|ITC-BOUAKE',p.company_id||'|ITC-SAN-PEDRO',p.company_id||'|ITC-YAMOUSSOUKRO'],
 updated_at=now()
 FROM previous old WHERE p.user_id=old.user_id RETURNING p.*
)
INSERT INTO app_records(collection,record_key,company_id,payload)
SELECT 'platformAuditLogs',gen_random_uuid()::text,p.company_id,
 jsonb_build_object('action','SEPARATE_REGIONAL_TRANSFER_ACCESS','company_id',p.company_id,'target',p.user_id,'date',now(),'before',old.control_scopes,'after',p.control_scopes)
FROM repaired p JOIN previous old USING(user_id);

UPDATE app_profiles p SET profile=profile||jsonb_build_object(
 'managedOps',(SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') FROM jsonb_each(p.control_scopes) WHERE value='true'::jsonb),
 'controlScopes',control_scopes,'controlScopeKeys',control_scope_keys,'stockScopeMode','explicit')
WHERE role='Gestionnaire' AND control_scopes->'ITC-B02'='true'::jsonb;
UPDATE app_records r SET payload=r.payload||jsonb_build_object('managedOps',p.profile->'managedOps','controlScopes',p.control_scopes,'controlScopeKeys',p.control_scope_keys,'stockScopeMode','explicit'),updated_at=now()
FROM app_profiles p WHERE r.collection='users' AND r.company_id=p.company_id
 AND (r.record_key=p.user_id::text OR r.payload->>'uid'=coalesce(p.firebase_uid,p.user_id::text))
 AND p.role='Gestionnaire' AND p.control_scopes->'ITC-B02'='true'::jsonb;

-- Provisioning and reassignment must not grant inventory ownership twice.
CREATE OR REPLACE FUNCTION public.guard_manager_ownership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE conflict text;
BEGIN
 IF NEW.role<>'Gestionnaire' THEN RETURN NEW; END IF;
 IF NEW.control_scopes->'ITC-B02'='true'::jsonb AND EXISTS(
   SELECT 1 FROM jsonb_each(NEW.control_scopes) WHERE key IN ('ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO') AND value='true'::jsonb
 ) THEN RAISE EXCEPTION 'Bureau 02 : les stocks des villes sont accessibles en consultation et transfert uniquement. Affectez leur gestion à leurs gestionnaires locaux.'; END IF;
 IF NOT NEW.is_active THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.role=OLD.role AND NEW.company_id=OLD.company_id AND NEW.is_active=OLD.is_active AND NEW.control_scopes=OLD.control_scopes THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(NEW.company_id));
 SELECT assigned.key INTO conflict FROM app_profiles p
 CROSS JOIN LATERAL jsonb_each(p.control_scopes) assigned
 WHERE p.company_id=NEW.company_id AND p.role='Gestionnaire' AND p.is_active AND p.user_id<>NEW.user_id
 AND assigned.value='true'::jsonb AND NEW.control_scopes->assigned.key='true'::jsonb LIMIT 1;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Ce stock possède déjà un gestionnaire actif : %. Retirez son affectation avant de le réattribuer.',conflict; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_manager_ownership() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_manager_ownership ON public.app_profiles;
CREATE TRIGGER guard_manager_ownership BEFORE INSERT OR UPDATE ON public.app_profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_manager_ownership();

-- Dedicated operations retain the direct-write workflow protections.
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
    (source.payload-'id'-'_order')||jsonb_build_object('id',target.record_key,'op',dest,'scope_key',actor.company_id||'|'||dest,'qty',quantity));
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
  'stockKey',stock_key,'before',source.payload,'after',source.payload||jsonb_build_object('label',label,'qty',after_qty),'reason',trim(reason),'ref',ref);
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
COMMIT;
