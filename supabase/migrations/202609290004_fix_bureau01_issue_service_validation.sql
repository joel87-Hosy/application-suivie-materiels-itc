-- Validate the service against the request's office instead of a hard-coded
-- service list that can drift away from the Bureau 01 form options.
BEGIN;
DO $$
DECLARE target regprocedure; definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.issue_validated_request(text,text,text)'::regprocedure,
  'public.issue_validated_request_before_validity(text,text,text)'::regprocedure,
  'public.issue_validated_request_substocks(text,text,text,jsonb)'::regprocedure,
  'public.resubmit_stock_request(text,jsonb,jsonb)'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(target) INTO definition;
  definition:=replace(definition,
   'service IS NULL OR service NOT IN (''B2B'',''DEP'',''MAIN'')',
   'service IS NULL OR length(trim(service))=0 OR (CASE WHEN actor.control_scopes ? ''ITC-B01'' THEN service NOT IN (''PROD'',''MBM'',''MFTTH'',''DR'',''MNM'',''DESS'',''LS'',''CIDATA'') ELSE service NOT IN (''B2B'',''DEP'',''MAIN'') END)');
  definition:=replace(definition,
   'service IS NULL OR service NOT IN (''B2B'',''DEP'',''MAIN'',''PROD'',''MBM'',''MR'',''DR'',''MNM'',''DESS'',''LS'')',
   'service IS NULL OR length(trim(service))=0 OR (CASE WHEN actor.control_scopes ? ''ITC-B01'' THEN service NOT IN (''PROD'',''MBM'',''MFTTH'',''DR'',''MNM'',''DESS'',''LS'',''CIDATA'') ELSE service NOT IN (''B2B'',''DEP'',''MAIN'') END)');
  EXECUTE definition;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
