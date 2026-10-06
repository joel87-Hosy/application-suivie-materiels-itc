-- Let the assigned coordinator remove a duplicate technical bon before signing.
-- Keep the deleted payload and actor in the tenant audit trail.
BEGIN;

CREATE OR REPLACE FUNCTION public.remove_duplicate_tech_bon(request_key text, expected_bon_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice') OR NOT actor.is_active THEN
  RAISE EXCEPTION 'Action réservée au coordinateur actif.';
 END IF;

 SELECT * INTO request FROM public.app_records
  WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL
   OR request.payload->>'id' IS DISTINCT FROM expected_bon_id
   OR request.payload->>'workflow' IS DISTINCT FROM 'TECH_BON_SORTIE'
   OR request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE COORDINATION'
   OR request.payload->>'coordinateurId' IS DISTINCT FROM actor.profile->>'id' THEN
  RAISE EXCEPTION 'Bon absent, déjà traité ou hors de votre flux de coordination.';
 END IF;
 IF EXISTS(
   SELECT 1 FROM public.app_records
    WHERE collection='sorties' AND company_id=actor.company_id
      AND payload->>'sourceDemandeId'=request.payload->>'id'
 ) THEN
  RAISE EXCEPTION 'Ce bon a déjà produit une sortie et ne peut plus être supprimé.';
 END IF;

 INSERT INTO public.app_records(collection,record_key,company_id,payload)
 VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','REMOVE_DUPLICATE_TECH_BON','company_id',actor.company_id,
     'requestId',request.payload->>'id','requestKey',request_key,'by',actor.user_id,
     'name',actor.profile->>'name','at',clock_timestamp(),'before',request.payload));
 DELETE FROM public.app_records
  WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
END $$;

REVOKE ALL ON FUNCTION public.remove_duplicate_tech_bon(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_duplicate_tech_bon(text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
