-- Let the assigned Bureau 02 manager remove a validated, not-yet-issued bon.
-- Keep the complete bon in the audit log and reject stale or out-of-scope requests.
BEGIN;
CREATE OR REPLACE FUNCTION public.remove_bureau02_pending_request(request_key text, expected_decision jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire'
   OR coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)<>'true'::jsonb THEN
  RAISE EXCEPTION 'Action réservée au gestionnaire du Bureau 02.';
 END IF;
 SELECT * INTO request FROM app_records
  WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN
  RAISE EXCEPTION 'Bon absent ou affecté à un autre gestionnaire.';
 END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE'
   OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true'
   OR request.payload->'validatorDecision' IS DISTINCT FROM expected_decision THEN
  RAISE EXCEPTION 'Le bon a changé ou ne peut plus être supprimé. Actualisez la liste.';
 END IF;
 IF EXISTS(SELECT 1 FROM app_records WHERE collection='sorties' AND company_id=actor.company_id AND payload->>'sourceDemandeId'=request.payload->>'id') THEN
  RAISE EXCEPTION 'Ce bon a déjà donné lieu à une sortie et ne peut pas être supprimé.';
 END IF;
 IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(request.payload->'items') item WHERE workflow_op(coalesce(item->>'op',request.payload->>'op')) NOT IN ('ITC-B02','MOOV')) THEN
  RAISE EXCEPTION 'Cette action concerne uniquement les bons du Bureau 02 (ITC-B02 et MOOV).';
 END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload)
 VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
  jsonb_build_object('action','SUPPRESSION_BON_B02','requestId',request.payload->>'id','requestKey',request_key,'company_id',actor.company_id,'by',actor.user_id,'name',actor.profile->>'name','at',now(),'before',request.payload));
 DELETE FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
END $$;
REVOKE ALL ON FUNCTION public.remove_bureau02_pending_request(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_bureau02_pending_request(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
