-- Match bon items to stock rows despite repeated, non-breaking, or invisible whitespace.
-- Keep ambiguity checks so a normalized match can never debit multiple stock articles.
BEGIN;
DO $$
DECLARE target regprocedure; definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.issue_validated_request_before_validity(text,text,text)'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(target) INTO definition;
  definition:=replace(definition,
   'upper(trim(value->>''label'')) AS label',
   'upper(regexp_replace(trim(value->>''label''), ''\s+'', '' '', ''g'')) AS label');
  definition:=replace(definition,
   'upper(trim(payload->>''label''))=item.label',
   'upper(regexp_replace(trim(payload->>''label''), ''\s+'', '' '', ''g''))=item.label');
  EXECUTE definition;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
