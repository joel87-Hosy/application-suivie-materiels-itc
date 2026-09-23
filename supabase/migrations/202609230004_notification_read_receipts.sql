BEGIN;
-- Reading is idempotent and does not depend on a stale copy of the whole payload.
CREATE OR REPLACE FUNCTION public.mark_app_notifications_read(record_keys text[])
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; result text[];
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.user_id IS NULL OR actor.profile->>'id' IS NULL THEN
   RAISE EXCEPTION 'Compte actif requis.';
 END IF;
 WITH marked AS (
   UPDATE public.app_records SET payload=jsonb_set(payload,'{lu}','true'::jsonb), updated_at=now()
   WHERE collection='notifications' AND record_key=ANY(record_keys)
     AND company_id=actor.company_id AND payload->>'userId'=actor.profile->>'id'
   RETURNING record_key
 ) SELECT coalesce(array_agg(record_key),ARRAY[]::text[]) INTO result FROM marked;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mark_app_notifications_read(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_app_notifications_read(text[]) TO authenticated;

-- Older clients also cannot resurrect a notification already read.
CREATE OR REPLACE FUNCTION public.preserve_notification_read() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.collection='notifications' AND OLD.payload->>'lu'='true' THEN
   NEW.payload=jsonb_set(NEW.payload,'{lu}','true'::jsonb);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS preserve_notification_read ON public.app_records;
CREATE TRIGGER preserve_notification_read BEFORE UPDATE ON public.app_records
FOR EACH ROW EXECUTE FUNCTION public.preserve_notification_read();
COMMIT;
