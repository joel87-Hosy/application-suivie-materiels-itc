BEGIN;
CREATE OR REPLACE FUNCTION public.delete_manager_stock_item(operation_id uuid, stock_key text, expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; item public.app_records; result jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Suppression réservée au gestionnaire actif.'; END IF;
 IF operation_id IS NULL THEN RAISE EXCEPTION 'Identifiant requis.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(actor.company_id));
 SELECT payload INTO result FROM app_records WHERE collection='platformAuditLogs' AND record_key=operation_id::text;
 IF result IS NOT NULL THEN
  IF result->>'action' IS DISTINCT FROM 'SUPPRESSION_ARTICLE' OR result->>'by' IS DISTINCT FROM actor.user_id::text OR result->>'company_id' IS DISTINCT FROM actor.company_id OR result->>'stockKey' IS DISTINCT FROM stock_key THEN RAISE EXCEPTION 'Opération non autorisée.'; END IF;
  RETURN result;
 END IF;
 SELECT * INTO item FROM app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id FOR UPDATE;
 IF item.record_key IS NULL OR coalesce(actor.control_scopes->workflow_op(item.payload->>'op'),'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Article absent ou stock hors de votre affectation.'; END IF;
 IF (item.payload-'_dbKey') IS DISTINCT FROM (expected-'_dbKey') THEN RAISE EXCEPTION 'Article modifié. Actualisez puis réessayez.'; END IF;
 result:=jsonb_build_object('action','SUPPRESSION_ARTICLE','id',operation_id,'company_id',actor.company_id,'stockKey',stock_key,'before',item.payload,'by',actor.user_id,'byName',actor.profile->>'name','date',now());
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',operation_id::text,actor.company_id,result);
 DELETE FROM app_records WHERE collection='stock' AND record_key=stock_key AND company_id=actor.company_id;
 INSERT INTO app_records(collection,record_key,company_id,payload)
 SELECT 'notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('company_id',actor.company_id,'userId',profile->'id','lu',false,'date',now(),'section','trafic-audit','message','SUPPRESSION ARTICLE : '||(item.payload->>'label')||' — stock '||(item.payload->>'op')||' — quantité '||(item.payload->>'qty'))
 FROM app_profiles WHERE company_id=actor.company_id AND is_active AND role IN ('Superviseur','DG');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.delete_manager_stock_item(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_manager_stock_item(uuid,text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
