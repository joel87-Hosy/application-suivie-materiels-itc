-- Let all Bureau 02 storekeepers scan, read, and serve Bureau 02 bons.
BEGIN;

CREATE OR REPLACE FUNCTION public.storekeeper_covers_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.storekeeper_has_office(details,scopes,public.storekeeper_request_office(company,request))
   AND (public.storekeeper_request_office(company,request)='B02' OR request->>'assignedMagasinierUid'=details->>'uid');
$$;

CREATE OR REPLACE FUNCTION public.storekeeper_can_read_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.storekeeper_has_office(details,scopes,public.storekeeper_request_office(company,request))
   AND (public.storekeeper_request_office(company,request)='B02'
     OR request->>'assignedMagasinierUid'=details->>'uid'
     OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(request#>'{materialService,events}')='array' THEN request#>'{materialService,events}' ELSE '[]'::jsonb END) event
       WHERE coalesce(event->>'uid',event->>'storekeeperUid')=details->>'uid'));
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
