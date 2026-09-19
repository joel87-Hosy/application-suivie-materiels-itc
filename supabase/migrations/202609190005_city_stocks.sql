BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.stock_locations (
 company_id text NOT NULL, op text NOT NULL, name text NOT NULL,
 PRIMARY KEY(company_id,op)
);
ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_locations_read ON public.stock_locations;
CREATE POLICY stock_locations_read ON public.stock_locations FOR SELECT TO authenticated
 USING(public.is_app_admin() OR company_id=(public.current_app_profile()).company_id);
GRANT SELECT ON public.stock_locations TO authenticated,service_role;
INSERT INTO public.stock_locations(company_id,op,name)
SELECT 'COMP-ITC-LEGACY',op,name FROM (VALUES
 ('ITC-B01','ITC Bureau 01'),('ITC-B02','ITC Bureau 02'),('OCI','OCI'),('CIC','CIC'),('MOOV','MOOV'),('MTN','MTN'),
 ('ITC-BOUAKE','ITC Bouaké'),('ITC-SAN-PEDRO','ITC San-Pédro'),('ITC-YAMOUSSOUKRO','ITC Yamoussoukro')) AS stocks(op,name)
ON CONFLICT(company_id,op) DO NOTHING;

CREATE OR REPLACE FUNCTION public.check_assigned_stocks(company text,stock_ops text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE scopes jsonb;
BEGIN
 IF stock_ops IS NULL THEN RAISE EXCEPTION 'Liste de stocks requise.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(stock_ops) AS selected(stock_op) WHERE selected.stock_op IS NULL OR NOT EXISTS(SELECT 1 FROM stock_locations s WHERE s.company_id=company AND s.op=selected.stock_op)) THEN
  RAISE EXCEPTION 'Stock inconnu ou hors de cette entreprise.';
 END IF;
 SELECT coalesce(jsonb_object_agg(op,true),'{}'::jsonb) INTO scopes FROM unnest(stock_ops) op;
 RETURN scopes;
END $$;
REVOKE ALL ON FUNCTION public.check_assigned_stocks(text,text[]) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.assign_manager_stocks(target_uid text,stock_ops text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; target app_profiles; scopes jsonb; keys jsonb; changes jsonb; affected integer;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','SUPER_ADMIN') THEN RAISE EXCEPTION 'Affectation réservée au superviseur.'; END IF;
 SELECT * INTO target FROM app_profiles WHERE coalesce(firebase_uid,user_id::text)=target_uid AND role='Gestionnaire' FOR UPDATE;
 IF target.user_id IS NULL OR (actor.role<>'SUPER_ADMIN' AND target.company_id<>actor.company_id) THEN RAISE EXCEPTION 'Gestionnaire hors de votre entreprise.'; END IF;
 IF coalesce(cardinality(stock_ops),0)=0 THEN RAISE EXCEPTION 'Sélectionnez au moins un stock.'; END IF;
 scopes:=check_assigned_stocks(target.company_id,stock_ops);
 SELECT coalesce(jsonb_object_agg(target.company_id||'|'||key,true),'{}'::jsonb) INTO keys FROM jsonb_each(scopes);
 changes:=jsonb_build_object('managedOps',to_jsonb(stock_ops),'controlScopes',scopes,'controlScopeKeys',keys,'stockScopeMode','explicit','updated_at',now(),'updated_by',actor.user_id);
 UPDATE app_profiles SET control_scopes=scopes,control_scope_keys=keys,profile=profile||changes,updated_at=now() WHERE user_id=target.user_id;
 UPDATE app_records SET payload=payload||changes,updated_at=now() WHERE collection='users' AND company_id=target.company_id AND payload->>'uid'=target_uid;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Fiche gestionnaire absente ou ambiguë.'; END IF;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,target.company_id,
  jsonb_build_object('action','ASSIGN_MANAGER_STOCKS','company_id',target.company_id,'target',target_uid,'by',actor.user_id,'before',target.control_scopes,'after',scopes,'date',now()));
END $$;
REVOKE ALL ON FUNCTION public.assign_manager_stocks(text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_manager_stocks(text,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_company_user(actor_id uuid,new_user_id uuid,company text,user_role text,user_name text,user_email text,stock_ops text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; scopes jsonb; keys jsonb; profile jsonb; company_record jsonb;
BEGIN
 SELECT * INTO actor FROM app_profiles WHERE user_id=actor_id AND is_active;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','SUPER_ADMIN') THEN RAISE EXCEPTION 'Création réservée au superviseur.'; END IF;
 IF company IS NULL OR (actor.role<>'SUPER_ADMIN' AND company<>actor.company_id) THEN RAISE EXCEPTION 'Entreprise non autorisée.'; END IF;
 IF user_role IS NULL OR user_role NOT IN ('Gestionnaire','Contrôleur','Coordinateur','Coordinatrice','Superviseur Terrain','Technicien','Validateur','Validatrice') THEN RAISE EXCEPTION 'Rôle non autorisé.'; END IF;
 IF nullif(trim(user_name),'') IS NULL OR length(user_name)>120 THEN RAISE EXCEPTION 'Nom invalide.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=new_user_id AND lower(email)=lower(user_email)) THEN RAISE EXCEPTION 'Identité Auth invalide.'; END IF;
  SELECT payload INTO company_record FROM app_records WHERE collection='companies' AND (record_key=company OR payload->>'id'=company) LIMIT 1;
 IF company_record IS NULL AND company='COMP-ITC-LEGACY' THEN
  company_record:=jsonb_build_object('id',company,'name','ITC','status','active');
 END IF;
 IF company_record IS NULL OR company_record->>'status'='suspended' THEN RAISE EXCEPTION 'Entreprise absente ou suspendue.'; END IF;
 IF user_role IN ('Gestionnaire','Validateur','Validatrice') AND coalesce(cardinality(stock_ops),0)=0 THEN RAISE EXCEPTION 'Sélectionnez au moins un stock.'; END IF;
 scopes:=check_assigned_stocks(company,stock_ops);
 IF user_role='Contrôleur' THEN scopes:='{}'::jsonb;stock_ops:=ARRAY[]::text[]; END IF;
 SELECT coalesce(jsonb_object_agg(company||'|'||key,true),'{}'::jsonb) INTO keys FROM jsonb_each(scopes);
 profile:=jsonb_build_object('id',floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,'uid',new_user_id,'email',lower(user_email),'name',trim(user_name),'full_name',trim(user_name),
  'company_id',company,'company_name',company_record->>'name','role',user_role,'managedOps',to_jsonb(stock_ops),'controlScopes',scopes,'controlScopeKeys',keys,
  'stockScopeMode','explicit','is_active',true,'account_status','active','must_change_password',true,'created_at',now(),'created_by',actor_id);
 INSERT INTO app_profiles(user_id,company_id,role,control_scopes,control_scope_keys,profile) VALUES(new_user_id,company,user_role,scopes,keys,profile);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('users',new_user_id::text,company,profile);
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,company,
  jsonb_build_object('action','CREATE_COMPANY_USER','company_id',company,'target',new_user_id,'role',user_role,'stocks',to_jsonb(stock_ops),'by',actor_id,'date',now()));
 RETURN profile-'email';
END $$;
REVOKE ALL ON FUNCTION public.register_company_user(uuid,uuid,text,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_company_user(uuid,uuid,text,text,text,text,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_dedicated_stock() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor app_profiles;
BEGIN
 IF current_user NOT IN ('authenticated','anon') OR coalesce(NEW.collection,OLD.collection)<>'stock' THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL OR actor.role NOT IN ('Gestionnaire','Superviseur','SUPER_ADMIN') THEN RAISE EXCEPTION 'Écriture du stock réservée au gestionnaire dédié.'; END IF;
 IF actor.role='Gestionnaire' THEN
  IF TG_OP<>'INSERT' AND coalesce(actor.control_scopes->workflow_op(OLD.payload->>'op'),'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Stock hors de votre affectation.'; END IF;
  IF TG_OP<>'DELETE' AND coalesce(actor.control_scopes->workflow_op(NEW.payload->>'op'),'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Stock hors de votre affectation.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS guard_dedicated_stock ON public.app_records;
CREATE TRIGGER guard_dedicated_stock BEFORE INSERT OR UPDATE OR DELETE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_dedicated_stock();
COMMIT;
