BEGIN;
ALTER TABLE public.stock_locations ADD COLUMN IF NOT EXISTS parent_op text;
ALTER TABLE public.stock_locations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE public.stock_locations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_locations_parent_fk' AND conrelid='public.stock_locations'::regclass) THEN
  ALTER TABLE public.stock_locations ADD CONSTRAINT stock_locations_parent_fk FOREIGN KEY(company_id,parent_op) REFERENCES public.stock_locations(company_id,op);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_manager_stock_location(operation_id uuid, location_name text, parent_stock text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; location stock_locations; stock_op text; scopes jsonb; keys jsonb; changes jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Création réservée au gestionnaire actif.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT * INTO actor FROM app_profiles WHERE user_id=actor.user_id FOR UPDATE;
 IF actor.role IS DISTINCT FROM 'Gestionnaire' OR NOT actor.is_active THEN RAISE EXCEPTION 'Gestionnaire actif requis.'; END IF;
 IF operation_id IS NULL OR nullif(trim(location_name),'') IS NULL OR length(trim(location_name))>100 THEN RAISE EXCEPTION 'Nom du stock requis (100 caractères maximum).'; END IF;
 stock_op:='STK-'||upper(operation_id::text);
 SELECT * INTO location FROM stock_locations WHERE company_id=actor.company_id AND op=stock_op;
 IF FOUND THEN
  IF location.created_by IS DISTINCT FROM actor.user_id OR location.name IS DISTINCT FROM trim(location_name) OR location.parent_op IS DISTINCT FROM parent_stock THEN RAISE EXCEPTION 'Identifiant de création déjà utilisé.'; END IF;
  RETURN to_jsonb(location);
 END IF;
 IF parent_stock IS NOT NULL AND (coalesce(actor.control_scopes->parent_stock,'false'::jsonb)<>'true'::jsonb OR NOT EXISTS(SELECT 1 FROM stock_locations WHERE company_id=actor.company_id AND op=parent_stock)) THEN RAISE EXCEPTION 'Stock parent hors de votre affectation.'; END IF;
 IF EXISTS(SELECT 1 FROM stock_locations WHERE company_id=actor.company_id AND parent_op IS NOT DISTINCT FROM parent_stock AND lower(name)=lower(trim(location_name))) THEN RAISE EXCEPTION 'Un stock porte déjà ce nom à cet emplacement.'; END IF;
 INSERT INTO stock_locations(company_id,op,name,parent_op,created_by) VALUES(actor.company_id,stock_op,trim(location_name),parent_stock,actor.user_id) RETURNING * INTO location;
 scopes:=actor.control_scopes||jsonb_build_object(stock_op,true);
 keys:=actor.control_scope_keys||jsonb_build_object(actor.company_id||'|'||stock_op,true);
 changes:=jsonb_build_object('managedOps',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(scopes) WHERE value='true'::jsonb),'controlScopes',scopes,'controlScopeKeys',keys,'stockScopeMode','explicit');
 UPDATE app_profiles SET control_scopes=scopes,control_scope_keys=keys,profile=profile||changes,updated_at=now() WHERE user_id=actor.user_id;
 UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=actor.company_id AND (record_key=actor.user_id::text OR payload->>'uid'=coalesce(actor.firebase_uid,actor.user_id::text));
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','CREATE_STOCK_LOCATION','by',actor.user_id,'company_id',actor.company_id,'location',to_jsonb(location),'date',now()));
 RETURN to_jsonb(location);
END $$;
REVOKE ALL ON FUNCTION public.create_manager_stock_location(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_manager_stock_location(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_manager_location_item(operation_id uuid, stock_op text, material_label text, material_type text, quantity numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; item app_records; prior jsonb; result jsonb; label text; before_qty numeric; item_key text;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Entrée réservée au gestionnaire actif.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT * INTO actor FROM app_profiles WHERE user_id=actor.user_id FOR UPDATE;
 IF actor.role IS DISTINCT FROM 'Gestionnaire' OR NOT actor.is_active THEN RAISE EXCEPTION 'Gestionnaire actif requis.'; END IF;
 IF coalesce(actor.control_scopes->stock_op,'false'::jsonb)<>'true'::jsonb OR NOT EXISTS(SELECT 1 FROM stock_locations WHERE company_id=actor.company_id AND op=stock_op AND created_by IS NOT NULL) THEN RAISE EXCEPTION 'Stock hors de votre affectation.'; END IF;
 label:=upper(regexp_replace(trim(material_label),'\s+',' ','g'));
 IF operation_id IS NULL OR nullif(label,'') IS NULL OR length(label)>200 OR nullif(trim(material_type),'') IS NULL OR length(trim(material_type))>100 OR quantity IS NULL OR quantity<=0 OR quantity>9007199254740991 OR quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Article, type et quantité positive valides requis.'; END IF;
 SELECT payload INTO prior FROM app_records WHERE collection='stockMovements' AND record_key=operation_id::text;
 IF FOUND THEN
  IF prior->>'actorUid' IS DISTINCT FROM actor.user_id::text OR prior->>'op' IS DISTINCT FROM stock_op OR prior->>'label' IS DISTINCT FROM label OR prior->>'materialType' IS DISTINCT FROM trim(material_type) OR (prior->>'qty')::numeric IS DISTINCT FROM quantity THEN RAISE EXCEPTION 'Identifiant de réception déjà utilisé.'; END IF;
  RETURN prior;
 END IF;
 IF (SELECT count(*) FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND payload->>'op'=stock_op AND upper(regexp_replace(trim(payload->>'label'),'\s+',' ','g'))=label)>1 THEN RAISE EXCEPTION 'Article ambigu dans ce stock.'; END IF;
 SELECT * INTO item FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND payload->>'op'=stock_op AND upper(regexp_replace(trim(payload->>'label'),'\s+',' ','g'))=label FOR UPDATE;
 before_qty:=coalesce((item.payload->>'qty')::numeric,0);
 IF before_qty<0 OR before_qty+quantity>9007199254740991 THEN RAISE EXCEPTION 'Quantité totale invalide.'; END IF;
 IF item.record_key IS NOT NULL AND item.payload->>'type' IS DISTINCT FROM trim(material_type) THEN RAISE EXCEPTION 'Cet article existe avec un autre type de matériel.'; END IF;
 item_key:=coalesce(item.record_key,gen_random_uuid()::text);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock',item_key,actor.company_id,coalesce(item.payload,'{}'::jsonb)||jsonb_build_object('id',item_key,'company_id',actor.company_id,'op',stock_op,'scope_key',actor.company_id||'|'||stock_op,'label',label,'type',trim(material_type),'qty',before_qty+quantity))
 ON CONFLICT(collection,record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now();
 result:=jsonb_build_object('id',operation_id,'company_id',actor.company_id,'op',stock_op,'scope_key',actor.company_id||'|'||stock_op,'label',label,'materialType',trim(material_type),'qty',quantity,'beforeQty',before_qty,'afterQty',before_qty+quantity,'type','in','source','reception','actorUid',actor.user_id,'byName',actor.profile->>'name','createdAt',now(),'date',now(),'reference',operation_id);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stockMovements',operation_id::text,actor.company_id,result);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,result||jsonb_build_object('action','RECEIVE_LOCATION_ITEM'));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.receive_manager_location_item(uuid,text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_manager_location_item(uuid,text,text,text,numeric) TO authenticated;

-- Custom locations have independent inventories, not the legacy B02 quantity buckets.
CREATE OR REPLACE FUNCTION public.bureau02_owns_stock(actor public.app_profiles, operator text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT actor.role='Gestionnaire' AND actor.is_active
 AND coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)='true'::jsonb
 AND coalesce(actor.control_scopes->workflow_op(operator),'false'::jsonb)='true'::jsonb
 AND workflow_op(operator) NOT IN ('ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO')
 AND workflow_op(operator) NOT LIKE 'STK-%';
$$;
COMMIT;
