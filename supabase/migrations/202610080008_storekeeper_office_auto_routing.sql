-- Storekeeper work is selected by office affiliation, so validators do not assign an individual.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.storekeeper_covers_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.storekeeper_has_office(details,scopes,public.storekeeper_request_office(company,request));
$$;

CREATE OR REPLACE FUNCTION public.storekeeper_can_read_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.storekeeper_has_office(details,scopes,public.storekeeper_request_office(company,request));
$$;

CREATE OR REPLACE FUNCTION public.decide_stock_request_signed(
 request_key text,approve boolean,manager_uid uuid,reason text,signer_name text,signature_image text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; target_office text;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF actor.role NOT IN ('Validateur','Validatrice') OR request.record_key IS NULL
   OR NOT public.validator_office_covers(actor.profile,actor.control_scopes,actor.company_id,request.payload)
   OR NOT public.validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre bureau ou de vos autorisations de signature.'; END IF;
 target_office:=public.storekeeper_request_office(actor.company_id,request.payload);
 IF approve AND target_office IS DISTINCT FROM 'B01' AND NOT EXISTS(
   SELECT 1 FROM public.app_profiles p WHERE p.company_id=actor.company_id AND p.is_active AND p.role='Magasinier'
    AND public.storekeeper_has_office(p.profile,p.control_scopes,target_office)) THEN
   RAISE EXCEPTION 'Aucun magasinier actif n?est rattach? au bureau de ce bon.';
 END IF;
 RETURN public.decide_stock_request_signed_unassigned(request_key,approve,manager_uid,reason,signer_name,signature_image);
END $$;

-- Keep compatibility with older clients while ignoring the obsolete individual choice.
CREATE OR REPLACE FUNCTION public.decide_stock_request_signed_assigned(
 request_key text,approve boolean,manager_uid uuid,storekeeper_uid uuid,reason text,
 signer_name text,signature_image text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN public.decide_stock_request_signed(request_key,approve,manager_uid,reason,signer_name,signature_image);
END $$;

GRANT EXECUTE ON FUNCTION public.decide_stock_request_signed(text,boolean,uuid,text,text,text),public.storekeeper_covers_request(jsonb,jsonb,text,jsonb),public.storekeeper_can_read_request(jsonb,jsonb,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.storekeeper_covers_request(jsonb,jsonb,text,jsonb),public.storekeeper_can_read_request(jsonb,jsonb,text,jsonb) FROM PUBLIC,anon;
NOTIFY pgrst,'reload schema';
COMMIT;
