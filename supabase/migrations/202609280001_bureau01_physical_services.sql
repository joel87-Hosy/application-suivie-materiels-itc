-- Accept Bureau 01 physical-bon services throughout validation and correction.
-- Existing Bureau 02 / technician affiliations retain their original services.
BEGIN;
DO $$
DECLARE target regprocedure; definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.issue_validated_request(text,text,text)'::regprocedure,
  'public.issue_validated_request_before_validity(text,text,text)'::regprocedure,
  'public.resubmit_stock_request(text,jsonb,jsonb)'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(target) INTO definition;
  definition:=replace(definition,
   '(''B2B'',''DEP'',''MAIN'')',
   '(''B2B'',''DEP'',''MAIN'',''PROD'',''MBM'',''MR'',''DR'',''MNM'',''DESS'',''LS'')');
  EXECUTE definition;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
