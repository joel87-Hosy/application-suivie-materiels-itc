BEGIN;

-- Reuse the existing sub-stock ledger for the principal Bureau 01 stocks.
-- Keep the historic function name because installed triggers and RPCs depend on it.
CREATE OR REPLACE FUNCTION public.bureau02_owns_stock(actor public.app_profiles, operator text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT actor.role='Gestionnaire' AND actor.is_active AND (
   (coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb
     AND workflow_op(operator) IN ('ITC-B01','OCI','CIC','MTN')
     AND coalesce(actor.control_scopes->workflow_op(operator),'false'::jsonb)='true'::jsonb)
   OR
   (coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)='true'::jsonb
     AND workflow_op(operator) IN ('ITC-B02','MOOV')
     AND coalesce(actor.control_scopes->workflow_op(operator),'false'::jsonb)='true'::jsonb)
 );
$$;

CREATE OR REPLACE FUNCTION public.issue_validated_request_substocks(request_key text, signature text, service text, selections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; requested jsonb; selected jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire'
   OR NOT (coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb
     OR coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)='true'::jsonb) THEN
   RAISE EXCEPTION 'Gestionnaire affecté au Bureau 01 ou 02 requis.';
 END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon hors de votre affectation.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation requise.'; END IF;
 IF jsonb_typeof(selections) IS DISTINCT FROM 'array' OR jsonb_array_length(selections)=0 THEN RAISE EXCEPTION 'Choisissez les sous-stocks.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(selections) s WHERE jsonb_typeof(s->'qty') IS DISTINCT FROM 'number' OR (s->>'qty')::numeric<=0 OR s->>'substock' IS NULL OR s->>'substock' NOT IN ('production','deploiement','maintenance','unallocated')) THEN RAISE EXCEPTION 'Sélection invalide.'; END IF;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY op,label) INTO requested FROM (SELECT workflow_op(coalesce(s->>'op',request.payload->>'op')) op,upper(trim(s->>'label')) label,sum((s->>'qty')::numeric) qty FROM jsonb_array_elements(request.payload->'items') s GROUP BY 1,2) t;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY op,label) INTO selected FROM (SELECT workflow_op(s->>'op') op,upper(trim(s->>'label')) label,sum((s->>'qty')::numeric) qty FROM jsonb_array_elements(selections) s GROUP BY 1,2) t;
 IF requested IS DISTINCT FROM selected THEN RAISE EXCEPTION 'La sélection doit correspondre exactement aux matériels et quantités du bon validé.'; END IF;
 UPDATE app_records SET payload=payload||jsonb_build_object('validatedItems',payload->'items','items',selections) WHERE collection='demandes' AND record_key=request_key;
 RETURN issue_validated_request(request_key,signature,service);
END $$;

REVOKE ALL ON FUNCTION public.issue_validated_request_substocks(text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_validated_request_substocks(text,text,text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
