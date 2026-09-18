-- Opt-in after both the new client and validator accounts are ready.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.stock_workflow_config (
  company_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE public.stock_workflow_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_config_read ON public.stock_workflow_config;
CREATE POLICY workflow_config_read ON public.stock_workflow_config FOR SELECT TO authenticated
 USING (company_id = (public.current_app_profile()).company_id);
GRANT SELECT ON public.stock_workflow_config TO authenticated;
GRANT SELECT ON public.stock_workflow_config TO service_role;

CREATE OR REPLACE FUNCTION public.save_app_changes(changes jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE change jsonb; previous jsonb;
BEGIN
 FOR change IN SELECT value FROM jsonb_array_elements(changes) ORDER BY value->>'collection',value->>'record_key' LOOP
   SELECT payload INTO previous FROM app_records WHERE collection=change->>'collection' AND record_key=change->>'record_key' FOR UPDATE;
   IF previous IS DISTINCT FROM nullif(change->'previous','null'::jsonb) THEN RAISE EXCEPTION 'Données modifiées par un autre utilisateur. Actualisez puis réessayez.'; END IF;
   INSERT INTO app_records(collection,record_key,company_id,payload,updated_at)
     VALUES(change->>'collection',change->>'record_key',change->>'company_id',change->'payload',now())
     ON CONFLICT(collection,record_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.save_app_changes(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_app_changes(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.workflow_op(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN upper(trim(value))='ITC' THEN 'ITC-B01' ELSE upper(trim(value)) END $$;

CREATE OR REPLACE FUNCTION public.workflow_managers() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('uid',user_id,'name',coalesce(profile->>'name',role),'scopes',control_scopes)), '[]'::jsonb)
 FROM app_profiles WHERE is_active AND role='Gestionnaire'
 AND company_id=(current_app_profile()).company_id;
$$;

CREATE OR REPLACE FUNCTION public.guard_stock_workflow() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE enabled boolean; actor public.app_profiles; previous jsonb;
BEGIN
 IF current_user NOT IN ('authenticated','anon') THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IN ('Validateur','Validatrice') AND coalesce(NEW.collection,OLD.collection)<>'notifications' THEN
   RAISE EXCEPTION 'Utilisez la validation des bons. Ce rôle consulte les autres données en lecture seule.';
 END IF;
 SELECT c.enabled INTO enabled FROM stock_workflow_config c WHERE c.company_id=coalesce(NEW.company_id,OLD.company_id);
 IF enabled IS NOT TRUE THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' AND OLD.collection IN ('stock','sorties','demandes') THEN RAISE EXCEPTION 'Suppression interdite : traçabilité des bons.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.collection='sorties' AND (TG_OP='INSERT' OR NEW.payload IS DISTINCT FROM OLD.payload) THEN
   RAISE EXCEPTION 'La sortie physique doit passer par un bon validé.';
 END IF;
 IF NEW.collection='stock' AND TG_OP='UPDATE' AND (NEW.payload->>'qty')::numeric < (OLD.payload->>'qty')::numeric THEN
   RAISE EXCEPTION 'Le débit du stock nécessite un bon validé et une sortie physique.';
 END IF;
 IF NEW.collection='demandes' THEN
   previous := CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE '{}'::jsonb END;
   IF (NEW.payload->'validatorDecision') IS DISTINCT FROM (previous->'validatorDecision') THEN
     RAISE EXCEPTION 'La décision appartient au validateur.';
   END IF;
   IF previous ? 'validatorDecision' AND NEW.payload IS DISTINCT FROM previous THEN
     RAISE EXCEPTION 'Bon déjà traité. Actualisez la liste avant toute opération.';
   END IF;
   IF coalesce(NEW.payload->>'status','') IN ('LIVREE','PRET','PREPAREE','APPROUVEE','EN ATTENTE GESTIONNAIRE')
      AND coalesce(previous->>'status','') NOT IN ('LIVREE') THEN
     NEW.payload := NEW.payload || jsonb_build_object('status','EN ATTENTE VALIDATEUR','statut','EN ATTENTE VALIDATEUR');
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_stock_workflow ON public.app_records;
CREATE TRIGGER guard_stock_workflow BEFORE INSERT OR UPDATE OR DELETE ON public.app_records
 FOR EACH ROW EXECUTE FUNCTION public.guard_stock_workflow();

CREATE OR REPLACE FUNCTION public.decide_stock_request(request_key text, approve boolean, manager_uid uuid DEFAULT NULL, reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; manager public.app_profiles; request public.app_records; item jsonb; decision jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS NULL OR actor.role NOT IN ('Validateur','Validatrice') THEN RAISE EXCEPTION 'Validation réservée au validateur.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'status'<>'EN ATTENTE VALIDATEUR' THEN RAISE EXCEPTION 'Bon absent ou déjà traité.'; END IF;
 IF approve IS NULL THEN RAISE EXCEPTION 'Décision requise.'; END IF;
 IF approve THEN
   SELECT * INTO manager FROM app_profiles WHERE user_id=manager_uid AND company_id=actor.company_id AND is_active AND role='Gestionnaire';
   IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Choisissez un gestionnaire actif de cette entreprise.'; END IF;
   IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(request.payload->'items') LOOP
     IF coalesce(manager.control_scopes->workflow_op(coalesce(item->>'op',request.payload->>'op')),'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Ce gestionnaire ne gère pas tous les stocks du bon. Séparez les demandes par gestionnaire.'; END IF;
     IF coalesce((item->>'qty')::numeric,0)<=0 THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
   END LOOP;
 ELSE
   IF length(trim(reason))=0 THEN RAISE EXCEPTION 'Motif de refus obligatoire.'; END IF;
 END IF;
 decision := jsonb_build_object('approved',approve,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason',left(trim(reason),1000));
 request.payload := request.payload || jsonb_build_object('validatorDecision',decision,'status',CASE WHEN approve THEN 'EN ATTENTE GESTIONNAIRE' ELSE 'REFUSEE VALIDATEUR' END,'statut',CASE WHEN approve THEN 'EN ATTENTE GESTIONNAIRE' ELSE 'REFUSEE VALIDATEUR' END,'assignedGestionnaireUid',manager.user_id,'assignedGestionnaireName',manager.profile->>'name');
 UPDATE app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES ('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','VALIDATION_BON','requestId',request.payload->>'id','decision',decision,'company_id',actor.company_id));
 RETURN request.payload;
END $$;

CREATE OR REPLACE FUNCTION public.issue_validated_request(request_key text, signature text, service text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; item record; result jsonb; sortie_key text; stock_count integer;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Sortie réservée au gestionnaire dédié.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon affecté à un autre gestionnaire.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation du validateur requise.'; END IF;
 IF length(trim(coalesce(signature,'')))=0 OR service IS NULL OR service NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Signature et service requis.'; END IF;
 -- Stable locking order prevents concurrent issues from overdrawing the same stock.
 PERFORM 1 FROM app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 FOR item IN SELECT workflow_op(coalesce(value->>'op',request.payload->>'op')) AS op,upper(trim(value->>'label')) AS label,sum((value->>'qty')::numeric) AS qty
   FROM jsonb_array_elements(request.payload->'items') GROUP BY 1,2 ORDER BY 1,2 LOOP
   IF item.qty IS NULL OR item.qty<=0 OR coalesce(actor.control_scopes->item.op,'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Quantité ou stock non autorisé.'; END IF;
   SELECT count(*) INTO stock_count FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=item.op AND upper(trim(payload->>'label'))=item.label;
   IF stock_count<>1 THEN RAISE EXCEPTION 'Article absent ou ambigu : % / %',item.op,item.label; END IF;
   SELECT * INTO stockrow FROM app_records WHERE collection='stock' AND company_id=actor.company_id AND workflow_op(payload->>'op')=item.op AND upper(trim(payload->>'label'))=item.label;
   IF coalesce((stockrow.payload->>'qty')::numeric,0)<item.qty THEN RAISE EXCEPTION 'Stock insuffisant : %',item.label; END IF;
   UPDATE app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-item.qty)),updated_at=now() WHERE collection='stock' AND record_key=stockrow.record_key;
 END LOOP;
 sortie_key := gen_random_uuid()::text;
 result := request.payload || jsonb_build_object('status','LIVREE','statut','LIVREE','sortieId',sortie_key,'serviceAbbreviation',service,'managerSignatureText',left(signature,500),'managerSignedAt',now(),'validatedAt',now(),'validatedBy',actor.profile->>'name','validatedById',actor.profile->'id','dateLivraison',now());
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES ('sorties',sortie_key,actor.company_id,result || jsonb_build_object('id',sortie_key,'sourceDemandeId',request.payload->>'id','date',now(),'tech',coalesce(request.payload->>'tech',request.payload->>'demandeurName'),'company_id',actor.company_id));
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 RETURN result;
END $$;

-- Compare-and-swap protects offcut approvals and physical movements from lost updates.
CREATE OR REPLACE FUNCTION public.save_offcut_state(company text, operator text, previous_state jsonb, next_state jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE changed integer;
BEGIN
 IF previous_state IS NULL THEN
   INSERT INTO cable_offcut_stores(company_id,op,state) VALUES(company,operator,next_state) ON CONFLICT DO NOTHING;
 ELSE
   UPDATE cable_offcut_stores SET state=next_state,updated_at=now() WHERE company_id=company AND op=operator AND state=previous_state;
 END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION public.save_offcut_state(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_offcut_state(text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.decide_stock_request(text,boolean,uuid,text),public.issue_validated_request(text,text,text),public.workflow_managers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stock_request(text,boolean,uuid,text),public.issue_validated_request(text,text,text),public.workflow_managers() TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_stock_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient jsonb; recipients jsonb; message text;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.payload->>'status' IS NOT DISTINCT FROM OLD.payload->>'status' THEN RETURN NEW; END IF;
 IF NEW.payload->>'status'='EN ATTENTE VALIDATEUR' THEN
   SELECT jsonb_agg(profile->'id') INTO recipients FROM app_profiles WHERE company_id=NEW.company_id AND is_active AND role IN ('Validateur','Validatrice');
   message := 'BON À VALIDER : '||coalesce(NEW.payload->>'ref',NEW.payload->>'id');
 ELSIF NEW.payload ? 'validatorDecision' THEN
   recipients := jsonb_build_array(NEW.payload->'demandeurOriginalId');
   IF NEW.payload->>'status'='EN ATTENTE GESTIONNAIRE' THEN
     SELECT recipients || jsonb_build_array(profile->'id') INTO recipients FROM app_profiles WHERE user_id::text=NEW.payload->>'assignedGestionnaireUid';
   END IF;
   message := coalesce(NEW.payload->>'ref',NEW.payload->>'id')||' : '||(NEW.payload->>'status')||coalesce(' — '||(NEW.payload#>>'{validatorDecision,reason}'),'');
 ELSE RETURN NEW;
 END IF;
 FOR recipient IN SELECT value FROM jsonb_array_elements(coalesce(recipients,'[]')) LOOP
   IF recipient='null'::jsonb THEN CONTINUE; END IF;
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,NEW.company_id,jsonb_build_object('id',gen_random_uuid()::text,'company_id',NEW.company_id,'userId',recipient,'message',message,'date',now(),'createdAt',now(),'lu',false));
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_stock_workflow ON public.app_records;
CREATE TRIGGER notify_stock_workflow AFTER INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.notify_stock_workflow();

CREATE OR REPLACE FUNCTION public.update_own_profile(changes jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; safe jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.user_id IS NULL THEN RAISE EXCEPTION 'Connexion requise.'; END IF;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO safe FROM jsonb_each(changes)
 WHERE key IN ('name','full_name','contact_name','phone','contact_email','must_change_password','password_changed_at');
 UPDATE app_profiles SET profile=profile||safe,updated_at=now() WHERE user_id=actor.user_id;
 UPDATE app_records SET payload=payload||safe,updated_at=now() WHERE collection='users' AND company_id=actor.company_id AND payload->>'uid'=coalesce(actor.firebase_uid,actor.user_id::text);
END $$;
REVOKE ALL ON FUNCTION public.update_own_profile(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile(jsonb) TO authenticated;
COMMIT;
