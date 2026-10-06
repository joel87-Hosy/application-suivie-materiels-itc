-- Restore the Bureau 01 process: the assigned manager's signed validation
-- debits the stock in the same transaction. Other managers keep the cashier flow.
BEGIN;

ALTER FUNCTION public.issue_stock_request_signed(text,text,text,text,jsonb)
  RENAME TO issue_stock_request_signed_storekeeper;

CREATE FUNCTION public.issue_stock_request_signed(
  request_key text, signer_name text, signature_image text, service text,
  selections jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor public.app_profiles;
  result jsonb;
  evidence jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();

  IF actor.role='Gestionnaire'
     AND coalesce(actor.control_scopes->'ITC-B01','false'::jsonb)='true'::jsonb
     AND coalesce(actor.control_scopes->'ITC-B02','false'::jsonb)<>'true'::jsonb THEN
    IF selections IS NOT NULL THEN
      RAISE EXCEPTION 'La sélection des articles n’est pas prise en charge pour le Bureau 01.';
    END IF;

    -- The established signed issue RPC validates the approved bon, manager
    -- assignment, selected stock rows, quantities and service, then debits atomically.
    result:=public.issue_validated_request_before_validity(request_key,signer_name,service);
    evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
    result:=result||jsonb_build_object(
      'managerSignedByUid',actor.user_id,
      'bonSignatures',coalesce(result->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence)
    );
    UPDATE public.app_records SET payload=result,updated_at=now()
      WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
    UPDATE public.app_records SET payload=payload||jsonb_build_object(
      'managerSignedByUid',actor.user_id,
      'bonSignatures',coalesce(payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence)
    ),updated_at=now()
      WHERE collection='sorties' AND company_id=actor.company_id
        AND (record_key=result->>'sortieId' OR payload->>'id'=result->>'sortieId');
    RETURN result;
  END IF;

  RETURN public.issue_stock_request_signed_storekeeper(
    request_key,signer_name,signature_image,service,selections
  );
END $$;

REVOKE ALL ON FUNCTION public.issue_stock_request_signed(text,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_stock_request_signed(text,text,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_stock_request_signed_storekeeper(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
