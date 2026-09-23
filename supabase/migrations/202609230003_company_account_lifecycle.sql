BEGIN;
CREATE TABLE IF NOT EXISTS public.company_account_operations (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, target_id uuid NOT NULL,
 target_key text NOT NULL, company_id text NOT NULL, action text NOT NULL,
 status text NOT NULL DEFAULT 'pending', user_record_keys text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE public.company_account_operations ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS company_account_one_pending ON public.company_account_operations(target_id) WHERE status='pending';
REVOKE ALL ON public.company_account_operations FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prepare_company_account_action(actor_id uuid,target_key text,action text,operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_profiles; op company_account_operations; keys text[]; next_status text;
BEGIN
 SELECT * INTO actor FROM app_profiles p WHERE p.user_id=actor_id AND p.is_active;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') THEN RAISE EXCEPTION 'Gestion des comptes réservée au directeur.'; END IF;
 IF action IS NULL OR action NOT IN ('suspend','disable','activate','delete') OR operation_id IS NULL THEN RAISE EXCEPTION 'Action invalide.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(target_key));
 SELECT * INTO op FROM company_account_operations o WHERE o.id=operation_id;
 IF op.id IS NOT NULL THEN
  IF op.actor_id<>actor_id OR op.target_key<>target_key OR op.action<>action OR (actor.role<>'SUPER_ADMIN' AND op.company_id<>actor.company_id) THEN RAISE EXCEPTION 'Opération non autorisée.'; END IF;
  RETURN to_jsonb(op);
 END IF;
 -- Resume an interrupted Auth operation even if Auth has already deleted the profile.
 SELECT * INTO op FROM company_account_operations o WHERE o.target_key=prepare_company_account_action.target_key AND o.status='pending' ORDER BY o.created_at LIMIT 1;
 IF op.id IS NOT NULL THEN
  IF (actor.role<>'SUPER_ADMIN' AND op.company_id<>actor.company_id) OR op.actor_id<>actor_id OR op.action<>action THEN RAISE EXCEPTION 'Une autre action est en cours sur ce compte. Terminez-la avant de continuer.'; END IF;
  RETURN to_jsonb(op);
 END IF;
 SELECT * INTO target FROM app_profiles p WHERE p.user_id::text=target_key OR p.firebase_uid=target_key FOR UPDATE;
 IF target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND target.company_id<>actor.company_id) THEN RAISE EXCEPTION 'Compte absent ou hors de votre entreprise.'; END IF;
 IF target.user_id=actor.user_id OR target.role='SUPER_ADMIN' OR (target.role IN ('Superviseur','DG') AND actor.role<>'SUPER_ADMIN') THEN RAISE EXCEPTION 'Ce compte administrateur est protégé.'; END IF;
 SELECT coalesce(array_agg(r.record_key),ARRAY[]::text[]) INTO keys FROM app_records r WHERE r.collection='users' AND r.company_id=target.company_id
 AND (r.record_key=target.user_id::text OR r.payload->>'uid'=coalesce(target.firebase_uid,target.user_id::text) OR r.payload->>'id'=target.profile->>'id');
 INSERT INTO company_account_operations(id,actor_id,target_id,target_key,company_id,action,user_record_keys)
 VALUES(operation_id,actor.user_id,target.user_id,target_key,target.company_id,action,keys) RETURNING * INTO op;
 next_status:=CASE action WHEN 'delete' THEN 'deletion_pending' WHEN 'activate' THEN 'activation_pending' WHEN 'disable' THEN 'disabled' ELSE 'suspended' END;
 -- Block data access first, including still-valid access tokens. Auth follows in the Edge Function.
 UPDATE app_profiles p SET is_active=false,profile=profile||jsonb_build_object('is_active',false,'account_status',next_status,'account_action_pending',action,'updated_at',now(),'updated_by',actor.user_id),updated_at=now() WHERE p.user_id=target.user_id;
 UPDATE app_records r SET payload=payload||jsonb_build_object('is_active',false,'account_status',next_status,'account_action_pending',action,'updated_at',now(),'updated_by',actor.user_id),updated_at=now() WHERE r.collection='users' AND r.record_key=ANY(keys);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',operation_id::text,target.company_id,
 jsonb_build_object('action','ACCOUNT_'||upper(action),'status','pending','target',target.user_id,'targetName',target.profile->>'name','by',actor.user_id,'company_id',target.company_id,'date',now()));
 RETURN to_jsonb(op);
END $$;

CREATE OR REPLACE FUNCTION public.finish_company_account_action(actor_id uuid,operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; op company_account_operations; active boolean; next_status text;
BEGIN
 SELECT * INTO actor FROM app_profiles p WHERE p.user_id=actor_id AND p.is_active;
 SELECT * INTO op FROM company_account_operations o WHERE o.id=operation_id FOR UPDATE;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','DG','SUPER_ADMIN') OR op.id IS NULL OR op.actor_id<>actor_id
 OR (actor.role<>'SUPER_ADMIN' AND actor.company_id<>op.company_id) THEN RAISE EXCEPTION 'Opération non autorisée.'; END IF;
 IF op.status='complete' THEN RETURN to_jsonb(op); END IF;
 IF op.action='delete' THEN
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=op.target_id) THEN RAISE EXCEPTION 'Suppression Auth non terminée.'; END IF;
  DELETE FROM app_records WHERE collection='users' AND record_key=ANY(op.user_record_keys) AND company_id=op.company_id;
  DELETE FROM app_profiles WHERE user_id=op.target_id;
 ELSE
  active:=op.action='activate';next_status:=CASE op.action WHEN 'activate' THEN 'active' WHEN 'disable' THEN 'disabled' ELSE 'suspended' END;
  UPDATE app_profiles SET is_active=active,profile=(profile-'account_action_pending')||jsonb_build_object('is_active',active,'account_status',next_status,'updated_at',now()),updated_at=now() WHERE user_id=op.target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil introuvable.'; END IF;
  UPDATE app_records SET payload=(payload-'account_action_pending')||jsonb_build_object('is_active',active,'account_status',next_status,'updated_at',now()),updated_at=now() WHERE collection='users' AND record_key=ANY(op.user_record_keys) AND company_id=op.company_id;
 END IF;
 UPDATE company_account_operations SET status='complete',completed_at=now() WHERE id=op.id RETURNING * INTO op;
 UPDATE app_records SET payload=payload||jsonb_build_object('status','complete','completedAt',now()),updated_at=now() WHERE collection='platformAuditLogs' AND record_key=op.id::text;
 RETURN to_jsonb(op);
END $$;
REVOKE ALL ON FUNCTION public.prepare_company_account_action(uuid,text,text,uuid),public.finish_company_account_action(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_company_account_action(uuid,text,text,uuid),public.finish_company_account_action(uuid,uuid) TO service_role;
COMMIT;
