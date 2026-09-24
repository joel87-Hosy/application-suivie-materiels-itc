BEGIN;
CREATE TABLE IF NOT EXISTS public.app_push_tokens (
 token text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 company_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_push_tokens FROM anon, authenticated;
GRANT ALL ON public.app_push_tokens TO service_role;
CREATE OR REPLACE FUNCTION public.register_app_push_token(device_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL THEN RAISE EXCEPTION 'Compte actif requis.'; END IF;
 IF device_token IS NULL OR length(device_token)<20 OR length(device_token)>4096 THEN RAISE EXCEPTION 'Jeton invalide.'; END IF;
 INSERT INTO app_push_tokens(token,user_id,company_id) VALUES(device_token,actor.user_id,actor.company_id)
 ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,company_id=EXCLUDED.company_id,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.register_app_push_token(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_app_push_token(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
