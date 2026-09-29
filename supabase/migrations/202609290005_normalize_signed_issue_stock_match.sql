-- Apply whitespace normalization to the actual issue functions used by the
-- signed-remittance workflow. Bureau 01 remains on the standard stock flow;
-- Bureau 02 keeps its explicit substock allocation workflow.
BEGIN;
DO $$
DECLARE target regprocedure; definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.issue_validated_request_before_validity(text,text,text)'::regprocedure,
  'public.issue_validated_request_substocks(text,text,text,jsonb)'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(target) INTO definition;
  definition:=replace(definition,
   'upper(trim(value->>''label'')) AS label',
   'upper(regexp_replace(trim(value->>''label''), ''\s+'', '' '', ''g'')) AS label');
  definition:=replace(definition,
   'upper(trim(payload->>''label''))=item.label',
   'upper(regexp_replace(trim(payload->>''label''), ''\s+'', '' '', ''g''))=item.label');
  definition:=replace(definition,
   'upper(trim(s->>''label'')) label',
   'upper(regexp_replace(trim(s->>''label''), ''\s+'', '' '', ''g'')) label');
  EXECUTE definition;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
