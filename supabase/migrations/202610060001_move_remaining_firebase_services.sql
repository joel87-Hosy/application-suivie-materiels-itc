+BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- One Supabase row per tenant and stock for inventory-control workflows.
CREATE TABLE IF NOT EXISTS public.stock_control_states (
 company_id text NOT NULL,
 op text NOT NULL,
 state jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_by uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,op)
);
ALTER TABLE public.stock_control_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_control_state_read ON public.stock_control_states;
CREATE POLICY stock_control_state_read ON public.stock_control_states
 FOR SELECT TO authenticated USING (
  company_id=(public.current_app_profile()).company_id AND
  (public.current_app_profile()).role IN ('Superviseur','Contrôleur','Gestionnaire') AND
  ((public.current_app_profile()).role IN ('Superviseur','Contrôleur') OR
   (public.current_app_profile()).control_scopes ? op OR
   (public.current_app_profile()).control_scope_keys ? (company_id||'|'||op))
 );
GRANT SELECT ON public.stock_control_states TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.stock_control_states FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.stock_control_states TO service_role;

CREATE OR REPLACE FUNCTION public.save_stock_control_state(operator text, expected_state jsonb, next_state jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; current_state jsonb; normalized_op text; inv_key text; old_inv jsonb; new_inv jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 normalized_op:=public.workflow_op(operator);
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','Contrôleur','Gestionnaire') THEN RAISE EXCEPTION 'Accès au contrôle des stocks refusé.'; END IF;
 IF normalized_op IS NULL OR normalized_op='' OR normalized_op<>upper(trim(operator)) THEN RAISE EXCEPTION 'Stock invalide.'; END IF;
 IF actor.role='Gestionnaire' AND NOT (actor.control_scopes ? normalized_op OR actor.control_scope_keys ? (actor.company_id||'|'||normalized_op)) THEN RAISE EXCEPTION 'Stock hors affectation.'; END IF;
 IF jsonb_typeof(next_state) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Données de contrôle invalides.'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(actor.company_id||'|'||normalized_op,0));
 SELECT state INTO current_state FROM public.stock_control_states WHERE company_id=actor.company_id AND op=normalized_op FOR UPDATE;
 IF current_state IS DISTINCT FROM expected_state THEN RETURN false; END IF;

 IF actor.role='Contrôleur' THEN
  IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(next_state->'inventories','{}'::jsonb)) n
    LEFT JOIN jsonb_each(coalesce(current_state->'inventories','{}'::jsonb)) o ON o.key=n.key
    WHERE (n.value->>'status' IN ('approved','closed') AND n.value->>'status' IS DISTINCT FROM o.value->>'status')
       OR n.value->'managerCounts' IS DISTINCT FROM o.value->'managerCounts'
       OR n.value->'managerResponse' IS DISTINCT FROM o.value->'managerResponse'
       OR n.value->'decision' IS DISTINCT FROM o.value->'decision') THEN
   RAISE EXCEPTION 'Décision réservée au superviseur ou au gestionnaire.';
  END IF;
 ELSIF actor.role='Gestionnaire' THEN
  IF (coalesce(next_state,'{}'::jsonb)-'inventories'-'events'-'preferences') IS DISTINCT FROM (coalesce(current_state,'{}'::jsonb)-'inventories'-'events'-'preferences') THEN
   RAISE EXCEPTION 'Le gestionnaire peut uniquement renseigner les comptages et observations de contrôle.';
  END IF;
  FOR inv_key,old_inv IN SELECT key,value FROM jsonb_each(coalesce(current_state->'inventories','{}'::jsonb)) LOOP
   new_inv:=next_state#>ARRAY['inventories',inv_key];
   IF new_inv IS NULL OR (new_inv-'managerCounts'-'managerResponse') IS DISTINCT FROM (old_inv-'managerCounts'-'managerResponse') THEN
    RAISE EXCEPTION 'Modification réservée au contrôleur ou au superviseur.';
   END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(next_state->'inventories','{}'::jsonb)) n
    LEFT JOIN jsonb_each(coalesce(current_state->'inventories','{}'::jsonb)) o ON o.key=n.key
    WHERE o.key IS NULL AND n.value->>'status' NOT IN ('draft','open')) THEN
   RAISE EXCEPTION 'Création de dossier de contrôle réservée au contrôleur.';
  END IF;
 END IF;

 INSERT INTO public.stock_control_states(company_id,op,state,updated_by,updated_at)
 VALUES(actor.company_id,normalized_op,next_state,actor.user_id,now())
 ON CONFLICT(company_id,op) DO UPDATE SET state=EXCLUDED.state,updated_by=EXCLUDED.updated_by,updated_at=now();
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_stock_control_state(text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_stock_control_state(text,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.safe_numeric(value text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
BEGIN
 IF value IS NULL OR trim(value)='' THEN RETURN NULL; END IF;
 RETURN value::numeric;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Apply all approved inventory differences in one transaction. The supervisor
-- must be independent from the controller who opened the inventory.
CREATE OR REPLACE FUNCTION public.apply_control_inventory(stock_op text, inventory_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; control_row public.stock_control_states; inventory jsonb; line jsonb; stock_row public.app_records;
        stock_key text; qty_before numeric; qty_after numeric; changed integer:=0; next_state jsonb; event_id text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.user_id IS NULL OR actor.role<>'Superviseur' THEN RAISE EXCEPTION 'Régularisation réservée au superviseur.'; END IF;
 SELECT * INTO control_row FROM public.stock_control_states WHERE company_id=actor.company_id AND op=public.workflow_op(stock_op) FOR UPDATE;
 IF control_row.company_id IS NULL THEN RAISE EXCEPTION 'Données de contrôle introuvables.'; END IF;
 inventory:=control_row.state#>ARRAY['inventories',inventory_id];
 IF inventory IS NULL OR inventory->>'status'<>'approved' THEN RAISE EXCEPTION 'Approbation du superviseur requise.'; END IF;
 IF inventory->>'createdBy'=coalesce(actor.firebase_uid,actor.user_id::text) THEN RAISE EXCEPTION 'Approbation indépendante requise.'; END IF;
 IF NOT jsonb_path_exists(inventory,'$.lines.* ? (@.counted != null)') OR NOT (inventory ? 'managerResponse') OR nullif(inventory#>>'{managerResponse,text}','') IS NULL THEN
  RAISE EXCEPTION 'Le contrôleur et le gestionnaire doivent compter chaque ligne et fournir leurs observations.';
 END IF;
 FOR stock_key,line IN SELECT key,value FROM jsonb_each(coalesce(inventory->'lines','{}'::jsonb)) LOOP
  IF NOT (line ? 'counted') OR NOT ((inventory#>ARRAY['managerCounts',stock_key]) ? 'qty') THEN RAISE EXCEPTION 'Comptages incomplets.'; END IF;
  SELECT * INTO stock_row FROM public.app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR UPDATE;
  IF stock_row.record_key IS NULL OR public.workflow_op(stock_row.payload->>'op')<>public.workflow_op(stock_op) THEN RAISE EXCEPTION 'Matériel hors périmètre.'; END IF;
  IF coalesce(stock_row.payload->'controlAdjustments','{}'::jsonb) ? inventory_id THEN CONTINUE; END IF;
  qty_before:=public.safe_numeric(stock_row.payload->>'qty');
  qty_after:=public.safe_numeric(line->>'counted');
  IF qty_before IS DISTINCT FROM public.safe_numeric(line->>'theoretical') THEN RAISE EXCEPTION 'Stock modifié depuis le gel. Actualisez l’inventaire.'; END IF;
  UPDATE public.app_records SET payload=payload||jsonb_build_object('qty',qty_after,
    'controlAdjustments',coalesce(payload->'controlAdjustments','{}'::jsonb)||jsonb_build_object(inventory_id,jsonb_build_object('before',qty_before,'after',qty_after,'delta',qty_after-qty_before))),
    updated_at=now() WHERE collection='stock' AND record_key=stock_key;
  changed:=changed+1;
 END LOOP;
 next_state:=jsonb_set(control_row.state,ARRAY['inventories',inventory_id,'status'],'"closed"'::jsonb,true)-'lock';
 next_state:=jsonb_set(next_state,'{events}',coalesce(next_state->'events','{}'::jsonb)||jsonb_build_object(event_id,jsonb_build_object('actorUid',coalesce(actor.firebase_uid,actor.user_id::text),'at',now(),'message','Régularisations appliquées et inventaire clôturé','recordId',inventory_id)),true);
 UPDATE public.stock_control_states SET state=next_state,updated_by=actor.user_id,updated_at=now() WHERE company_id=actor.company_id AND op=control_row.op;
 RETURN jsonb_build_object('updated',changed,'state',next_state);
END $$;
REVOKE ALL ON FUNCTION public.apply_control_inventory(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_control_inventory(text,text) TO authenticated;

-- Public login branding exposes only the chosen tenant's non-sensitive fields.
CREATE OR REPLACE FUNCTION public.get_tenant_branding(tenant_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',r.payload->>'id','name',r.payload->>'name',
   'logo_url',r.payload->>'logo_url','status',r.payload->>'status')
 FROM public.app_records r
 WHERE r.collection='companies' AND (r.record_key=tenant_id OR r.payload->>'id'=tenant_id)
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_tenant_branding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_branding(text) TO anon,authenticated;

-- Native Web Push subscriptions replace Firebase Messaging device tokens.
CREATE TABLE IF NOT EXISTS public.app_push_subscriptions (
 endpoint text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 company_id text NOT NULL,
 subscription jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_push_subscriptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.app_push_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION public.register_app_push_subscription(push_subscription jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; endpoint_value text;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 endpoint_value:=push_subscription->>'endpoint';
 IF actor.user_id IS NULL OR actor.company_id IS NULL THEN RAISE EXCEPTION 'Compte actif requis.'; END IF;
 IF endpoint_value IS NULL OR length(endpoint_value)>2048 OR endpoint_value NOT LIKE 'https://%' OR
    length(coalesce(push_subscription#>>'{keys,p256dh}',''))<80 OR length(coalesce(push_subscription#>>'{keys,auth}',''))<16 THEN
  RAISE EXCEPTION 'Abonnement Web Push invalide.';
 END IF;
 INSERT INTO public.app_push_subscriptions(endpoint,user_id,company_id,subscription)
 VALUES(endpoint_value,actor.user_id,actor.company_id,push_subscription)
 ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,company_id=EXCLUDED.company_id,subscription=EXCLUDED.subscription,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.register_app_push_subscription(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_app_push_subscription(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_app_push_subscription(endpoint_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM public.app_push_subscriptions WHERE endpoint=endpoint_value AND user_id=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.remove_app_push_subscription(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_app_push_subscription(text) TO authenticated;

-- Move the staged Realtime Database stock-control data into tenant rows when
-- the original migration snapshot is available in this Supabase project.
DO $$
DECLARE snapshot text;
BEGIN
 IF to_regclass('migration_private.firebase_snapshots') IS NULL OR to_regclass('migration_private.firebase_documents') IS NULL THEN RETURN; END IF;
 SELECT id INTO snapshot FROM migration_private.firebase_snapshots ORDER BY imported_at DESC LIMIT 1;
 IF snapshot IS NULL THEN RETURN; END IF;
 INSERT INTO public.stock_control_states(company_id,op,state)
 SELECT split_part(source_path,'/',2),split_part(source_path,'/',3),payload
 FROM migration_private.firebase_documents
 WHERE snapshot_id=snapshot AND source_path LIKE 'stock_control/%/%'
 ON CONFLICT(company_id,op) DO NOTHING;

 UPDATE public.app_records company SET payload=company.payload||jsonb_build_object(
   'logo_url',branding.payload->>'logo_url','status',coalesce(branding.payload->>'status',company.payload->>'status'))
 FROM migration_private.firebase_documents branding
 WHERE branding.snapshot_id=snapshot AND branding.source_path='tenant_branding/'||(company.payload->>'id')
 AND company.collection='companies';
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
