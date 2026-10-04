BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_substock_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  stock_op text NOT NULL,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.app_profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manager_substock_categories_name_unique
  ON public.manager_substock_categories(company_id,stock_op,(lower(name)));
REVOKE ALL ON public.manager_substock_categories FROM PUBLIC,anon,authenticated;
ALTER TABLE public.manager_substock_categories ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.manager_b01_owns_stock(actor public.app_profiles, operator text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT actor.role='Gestionnaire' AND actor.is_active
  AND coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb
  AND workflow_op(operator) IN ('ITC-B01','OCI','CIC','MTN')
  AND coalesce(actor.control_scopes->workflow_op(operator),'false'::jsonb)='true'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.check_substock_quantities(buckets jsonb, total numeric) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE entry record; amount numeric:=0;
BEGIN
 IF jsonb_typeof(buckets) IS DISTINCT FROM 'object' OR total IS NULL OR total<0 OR total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Répartition invalide.'; END IF;
 FOR entry IN SELECT * FROM jsonb_each(buckets) LOOP
  IF entry.key NOT IN ('production','deploiement','maintenance') AND entry.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Sous-stock invalide.'; END IF;
  IF jsonb_typeof(entry.value) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
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
  IF NEW.payload ? '_substockDebit' THEN RAISE EXCEPTION 'Utilisez la confirmation du bon validé.'; END IF;
  SELECT * INTO actor FROM current_app_profile();
  IF (TG_OP='INSERT' AND NEW.payload ? 'subStocks') OR (TG_OP='UPDATE' AND NEW.payload->'subStocks' IS DISTINCT FROM OLD.payload->'subStocks') THEN RAISE EXCEPTION 'Utilisez la réorganisation des sous-stocks.'; END IF;
  IF (bureau02_owns_stock(actor,NEW.payload->>'op') OR manager_b01_owns_stock(actor,NEW.payload->>'op'))
    AND (TG_OP='INSERT' OR NEW.payload->'qty' IS DISTINCT FROM OLD.payload->'qty') THEN RAISE EXCEPTION 'Choisissez le formulaire dédié à ce stock.'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.payload ? 'subStocks' OR NEW.payload ? '_substockDebit') AND (NEW.payload->>'qty')::numeric<(OLD.payload->>'qty')::numeric THEN
  buckets:=coalesce(OLD.payload->'subStocks','{}'::jsonb);delta:=(OLD.payload->>'qty')::numeric-(NEW.payload->>'qty')::numeric;remaining:=delta;
  IF NEW.payload ? '_substockDebit' THEN
   bucket:=NEW.payload->>'_substockDebit';
   IF bucket='unallocated' THEN
    IF (OLD.payload->>'qty')::numeric-(SELECT coalesce(sum(value::text::numeric),0) FROM jsonb_each(buckets))<delta THEN RAISE EXCEPTION 'Quantité insuffisante dans le stock à répartir.'; END IF;
   ELSE
    IF coalesce((buckets->>bucket)::numeric,0)<delta THEN RAISE EXCEPTION 'Quantité insuffisante dans le sous-stock choisi : %',bucket; END IF;
    buckets:=jsonb_set(buckets,ARRAY[bucket],to_jsonb((buckets->>bucket)::numeric-delta));remaining:=0;
   END IF;
  ELSIF workflow_op(NEW.payload->>'op') IN ('ITC-B02','MOOV') THEN
   FOREACH bucket IN ARRAY ARRAY['production','deploiement','maintenance'] LOOP
    taken:=least(remaining,coalesce((buckets->>bucket)::numeric,0));
    buckets:=jsonb_set(buckets,ARRAY[bucket],to_jsonb(coalesce((buckets->>bucket)::numeric,0)-taken));remaining:=remaining-taken;
   END LOOP;
  ELSE
   FOR bucket IN SELECT k FROM jsonb_object_keys(buckets) AS t(k) ORDER BY k LOOP
    taken:=least(remaining,coalesce((buckets->>bucket)::numeric,0));
    buckets:=jsonb_set(buckets,ARRAY[bucket],to_jsonb(coalesce((buckets->>bucket)::numeric,0)-taken));remaining:=remaining-taken;
    EXIT WHEN remaining<=0;
   END LOOP;
  END IF;
  NEW.payload:=jsonb_set(NEW.payload-'_substockDebit','{subStocks}',buckets);
  INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,NEW.company_id,
   jsonb_build_object('action','DEBIT_SOUS_STOCKS','company_id',NEW.company_id,'stockKey',NEW.record_key,'op',NEW.payload->>'op','label',NEW.payload->>'label','qty',delta,'before',OLD.payload->'subStocks','after',buckets,'unallocatedDebit',remaining,'by',auth.uid(),'date',now()));
 END IF;
 IF NEW.payload ? 'subStocks' THEN PERFORM check_substock_quantities(NEW.payload->'subStocks',(NEW.payload->>'qty')::numeric); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_stock_substocks ON public.app_records;
CREATE TRIGGER guard_stock_substocks BEFORE INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_stock_substocks();

CREATE OR REPLACE FUNCTION public.list_manager_substock_categories(stock_op text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; op text;
BEGIN
 SELECT * INTO actor FROM current_app_profile();op:=workflow_op(stock_op);
 IF NOT manager_b01_owns_stock(actor,op) THEN RAISE EXCEPTION 'Stock hors de votre affectation Bureau 01.'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'name',name) ORDER BY created_at,id)
  FROM manager_substock_categories WHERE company_id=actor.company_id AND stock_op=op),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.create_manager_substock_category(stock_op text, substock_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; op text; label text; category manager_substock_categories;
BEGIN
 SELECT * INTO actor FROM current_app_profile();op:=workflow_op(stock_op);label:=trim(regexp_replace(coalesce(substock_name,''),'\s+',' ','g'));
 IF NOT manager_b01_owns_stock(actor,op) THEN RAISE EXCEPTION 'Stock hors de votre affectation Bureau 01.'; END IF;
 IF label='' OR length(label)>80 THEN RAISE EXCEPTION 'Saisissez un nom de sous-stock de 1 à 80 caractères.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id||'|'||op));
 INSERT INTO manager_substock_categories(company_id,stock_op,name,created_by) VALUES(actor.company_id,op,label,actor.user_id)
 ON CONFLICT(company_id,stock_op,(lower(name))) DO NOTHING RETURNING * INTO category;
 IF category.id IS NULL THEN RAISE EXCEPTION 'Ce sous-stock existe déjà pour ce stock.'; END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
  jsonb_build_object('action','CREATE_MANAGER_SUBSTOCK','by',actor.user_id,'company_id',actor.company_id,'stockOp',op,'substockId',category.id,'name',label,'date',now()));
 RETURN jsonb_build_object('id',category.id::text,'name',category.name);
END $$;

CREATE OR REPLACE FUNCTION public.reorganize_stock_substocks(stock_key text, expected jsonb, buckets jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; item public.app_records; result jsonb; op text;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT * INTO item FROM app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR UPDATE;
 op:=workflow_op(item.payload->>'op');
 IF item.record_key IS NULL OR NOT (bureau02_owns_stock(actor,op) OR manager_b01_owns_stock(actor,op)) THEN RAISE EXCEPTION 'Stock hors de votre affectation.'; END IF;
 IF (item.payload-'_dbKey') IS DISTINCT FROM (expected-'_dbKey') THEN RAISE EXCEPTION 'Stock modifié. Actualisez puis réessayez.'; END IF;
 PERFORM check_substock_quantities(buckets,(item.payload->>'qty')::numeric);
 IF manager_b01_owns_stock(actor,op) AND EXISTS(SELECT 1 FROM jsonb_object_keys(buckets) AS t(k) WHERE NOT EXISTS(
   SELECT 1 FROM manager_substock_categories c WHERE c.company_id=actor.company_id AND c.stock_op=op AND c.id::text=t.k)) THEN RAISE EXCEPTION 'Créez les sous-stocks avant de répartir le stock.'; END IF;
 IF bureau02_owns_stock(actor,op) AND EXISTS(SELECT 1 FROM jsonb_object_keys(buckets) AS t(k) WHERE t.k NOT IN ('production','deploiement','maintenance')) THEN RAISE EXCEPTION 'Sous-stock invalide pour le Bureau 02.'; END IF;
 result:=item.payload||jsonb_build_object('subStocks',buckets);
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='stock' AND record_key=stock_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','REORGANISATION_SOUS_STOCKS','by',actor.user_id,'company_id',actor.company_id,'stockKey',stock_key,'before',item.payload,'after',result,'date',now()));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.list_manager_substock_categories(text),public.create_manager_substock_category(text,text),public.reorganize_stock_substocks(text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_manager_substock_categories(text),public.create_manager_substock_category(text,text),public.reorganize_stock_substocks(text,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
