BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Keep role creation compatible on databases where the earlier storekeeper
-- migration was not applied. Magasiniers are company-wide and have no stock
-- or office assignment.
CREATE OR REPLACE FUNCTION public.register_company_user(
 actor_id uuid, new_user_id uuid, company text, user_role text,
 user_name text, user_email text, stock_ops text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 actor public.app_profiles;
 scopes jsonb;
 keys jsonb;
 profile jsonb;
 company_record jsonb;
BEGIN
 SELECT * INTO actor FROM public.app_profiles WHERE user_id=actor_id AND is_active;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','SUPER_ADMIN') THEN
  RAISE EXCEPTION 'Création réservée au superviseur.';
 END IF;
 IF company IS NULL OR (actor.role<>'SUPER_ADMIN' AND company<>actor.company_id) THEN
  RAISE EXCEPTION 'Entreprise non autorisée.';
 END IF;
 IF user_role IS NULL OR user_role NOT IN ('Gestionnaire','Magasinier','Contrôleur','Coordinateur','Coordinatrice','Superviseur Terrain','Technicien','Validateur','Validatrice') THEN
  RAISE EXCEPTION 'Rôle non autorisé.';
 END IF;
 IF nullif(trim(user_name),'') IS NULL OR length(user_name)>120 THEN
  RAISE EXCEPTION 'Nom invalide.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=new_user_id AND lower(email)=lower(user_email)) THEN
  RAISE EXCEPTION 'Identité Auth invalide.';
 END IF;

 SELECT payload INTO company_record FROM public.app_records
  WHERE collection='companies' AND (record_key=company OR payload->>'id'=company) LIMIT 1;
 IF company_record IS NULL AND company='COMP-ITC-LEGACY' THEN
  company_record:=jsonb_build_object('id',company,'name','ITC','status','active');
 END IF;
 IF company_record IS NULL OR company_record->>'status'='suspended' THEN
  RAISE EXCEPTION 'Entreprise absente ou suspendue.';
 END IF;
 IF user_role IN ('Gestionnaire','Validateur','Validatrice') AND coalesce(cardinality(stock_ops),0)=0 THEN
  RAISE EXCEPTION 'Sélectionnez au moins un stock.';
 END IF;
 IF user_role IN ('Contrôleur','Magasinier') THEN stock_ops:=ARRAY[]::text[]; END IF;

 scopes:=public.check_assigned_stocks(company,stock_ops);
 IF user_role IN ('Contrôleur','Magasinier') THEN scopes:='{}'::jsonb; END IF;
 SELECT coalesce(jsonb_object_agg(company||'|'||key,true),'{}'::jsonb) INTO keys FROM jsonb_each(scopes);
 profile:=jsonb_build_object(
  'id',floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
  'uid',new_user_id,'email',lower(user_email),'name',trim(user_name),'full_name',trim(user_name),
  'company_id',company,'company_name',company_record->>'name','role',user_role,
  'managedOps',to_jsonb(stock_ops),'controlScopes',scopes,'controlScopeKeys',keys,
  'stockScopeMode','explicit','is_active',true,'account_status','active',
  'must_change_password',true,'created_at',now(),'created_by',actor_id
 );
 INSERT INTO public.app_profiles(user_id,company_id,role,control_scopes,control_scope_keys,profile)
  VALUES(new_user_id,company,user_role,scopes,keys,profile);
 INSERT INTO public.app_records(collection,record_key,company_id,payload)
  VALUES('users',new_user_id::text,company,profile);
 INSERT INTO public.app_records(collection,record_key,company_id,payload)
  VALUES('platformAuditLogs',gen_random_uuid()::text,company,
   jsonb_build_object('action','CREATE_COMPANY_USER','company_id',company,'target',new_user_id,
    'role',user_role,'stocks',to_jsonb(stock_ops),'by',actor_id,'date',now()));
 RETURN profile-'email';
END $$;

REVOKE ALL ON FUNCTION public.register_company_user(uuid,uuid,text,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_company_user(uuid,uuid,text,text,text,text,text[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
