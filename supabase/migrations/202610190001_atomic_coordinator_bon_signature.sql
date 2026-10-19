BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.sign_technician_bon_as_coordinator(
  request_key text,
  expected_status text,
  expected_items jsonb,
  items jsonb,
  assigned_manager_id bigint,
  signature_name text,
  signature_image text,
  routing jsonb DEFAULT '{}'::jsonb,
  adjusted boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor public.app_profiles;
  request public.app_records;
  manager public.app_profiles;
  evidence jsonb;
  result jsonb;
  old_items jsonb;
BEGIN
  SELECT * INTO actor FROM public.current_app_profile();
  IF actor.user_id IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice','Coordinateur V1','Superviseur','Superviseur Terrain') THEN
    RAISE EXCEPTION 'Signature réservée à la coordination.';
  END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 OR jsonb_typeof(expected_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Les articles du bon sont invalides.';
  END IF;
  IF jsonb_typeof(coalesce(routing,'{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Les changements de coordination sont invalides.';
  END IF;
  SELECT * INTO manager FROM public.app_profiles
   WHERE company_id=actor.company_id AND user_id=assigned_manager_id AND is_active AND role='Gestionnaire' FOR SHARE;
  IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Gestionnaire affecté introuvable ou inactif.'; END IF;
  SELECT * INTO request FROM public.app_records
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
  IF request.record_key IS NULL OR request.payload->>'status' IS DISTINCT FROM expected_status
     OR request.payload->>'coordinateurId' IS DISTINCT FROM actor.profile->>'id'
     OR request.payload->'validatorDecision' IS NOT NULL
     OR request.payload->'items' IS DISTINCT FROM expected_items THEN
    RAISE EXCEPTION 'Cette demande a été modifiée ou traitée. Actualisez puis réessayez.';
  END IF;
  IF (items IS DISTINCT FROM expected_items) IS DISTINCT FROM coalesce(adjusted,false) THEN
    RAISE EXCEPTION 'Les changements de coordination sont invalides.';
  END IF;
  old_items:=request.payload->'items';
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(items) item
    WHERE coalesce(item->>'label','')='' OR coalesce(item->>'op','')=''
       OR coalesce((item->>'qty')::numeric,0)<=0
       OR coalesce(actor.control_scopes->public.workflow_op(item->>'op'),'false'::jsonb)<>'true'::jsonb
       OR coalesce(manager.control_scopes->public.workflow_op(item->>'op'),'false'::jsonb)<>'true'::jsonb
  ) THEN RAISE EXCEPTION 'Un article, une quantité ou le périmètre du gestionnaire est invalide.'; END IF;
  IF actor.role IN ('Coordinateur','Coordinatrice') AND
     public.account_office(actor.profile,actor.control_scopes) IS DISTINCT FROM
     public.request_origin_office(actor.company_id,request.payload) THEN
    RAISE EXCEPTION 'Cette demande est hors de votre périmètre de coordination.';
  END IF;
  evidence:=public.bon_signature_evidence(signature_name,signature_image,actor);
  result:=request.payload || jsonb_strip_nulls(coalesce(routing,'{}'::jsonb)) || jsonb_build_object(
    'items',items,
    'assignedGestionnaireUid',manager.user_id::text,
    'assignedGestionnaireId',manager.profile->'id',
    'assignedGestionnaireName',manager.profile->>'name',
    'coordinationSignatureText',evidence->>'name',
    'coordinationSignedAt',evidence->'at',
    'coordinationBy',actor.profile->>'name',
    'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('coordination',evidence),
    'status','EN ATTENTE VALIDATEUR',
    'statut','EN ATTENTE VALIDATEUR'
  );
  IF coalesce(adjusted,false) THEN
    result:=result || jsonb_build_object(
      'coordinationAdjustments',coalesce(request.payload->'coordinationAdjustments','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
        'at',clock_timestamp(),'byId',actor.profile->'id','by',actor.profile->>'name','beforeItems',old_items,'afterItems',items)),
      'coordinationItemsAdjustedAt',clock_timestamp()
    );
  END IF;
  UPDATE public.app_records SET payload=result,updated_at=clock_timestamp()
   WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.sign_technician_bon_as_coordinator(text,text,jsonb,jsonb,bigint,text,text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_technician_bon_as_coordinator(text,text,jsonb,jsonb,bigint,text,text,jsonb,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
