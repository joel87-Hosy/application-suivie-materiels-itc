-- Restrict decisions and new-request notifications to the validator's dedicated stocks.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.validator_covers_request(scopes jsonb, request jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE item jsonb; operator text;
BEGIN
 IF jsonb_typeof(request->'items') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(request->'items')=0 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(request->'items') LOOP
   operator := workflow_op(coalesce(nullif(trim(item->>'op'),''),request->>'op'));
   IF coalesce(scopes->operator,'false'::jsonb)<>'true'::jsonb THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.decide_stock_request(request_key text, approve boolean, manager_uid uuid DEFAULT NULL, reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; manager public.app_profiles; request public.app_records; item jsonb; decision jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS NULL OR actor.role NOT IN ('Validateur','Validatrice') THEN RAISE EXCEPTION 'Validation réservée au validateur.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE VALIDATEUR' THEN RAISE EXCEPTION 'Bon absent ou déjà traité.'; END IF;
 IF NOT validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Ce bon dépend de stocks hors de votre bureau de validation.'; END IF;
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
CREATE OR REPLACE FUNCTION public.notify_stock_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient jsonb; recipients jsonb; message text;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.payload->>'status' IS NOT DISTINCT FROM OLD.payload->>'status' THEN RETURN NEW; END IF;
 IF NEW.payload->>'status'='EN ATTENTE VALIDATEUR' THEN
   SELECT jsonb_agg(profile->'id') INTO recipients FROM app_profiles WHERE company_id=NEW.company_id AND is_active AND role IN ('Validateur','Validatrice') AND validator_covers_request(control_scopes,NEW.payload);
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
COMMIT;
