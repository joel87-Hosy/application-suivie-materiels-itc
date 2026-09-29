-- Device clocks can be stale. Use the database timestamp for bons without an
-- explicitly selected physical-bon date; preserve dateBon when it was chosen.
BEGIN;

UPDATE public.app_records
SET payload=jsonb_set(payload,'{date}',payload->'bonCreatedAt',true),updated_at=now()
WHERE collection='demandes'
  AND nullif(trim(payload->>'dateBon'),'') IS NULL
  AND jsonb_typeof(payload->'bonCreatedAt')='string'
  AND payload->'date' IS DISTINCT FROM payload->'bonCreatedAt';

CREATE OR REPLACE FUNCTION public.stamp_request_creation_date() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE moment timestamptz:=clock_timestamp();
BEGIN
 IF NEW.collection='demandes' AND TG_OP='INSERT'
    AND nullif(trim(NEW.payload->>'dateBon'),'') IS NULL THEN
  NEW.payload:=NEW.payload||jsonb_build_object('date',moment);
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aa_stamp_request_creation_date ON public.app_records;
CREATE TRIGGER aa_stamp_request_creation_date BEFORE INSERT ON public.app_records
FOR EACH ROW EXECUTE FUNCTION public.stamp_request_creation_date();

NOTIFY pgrst,'reload schema';
COMMIT;
