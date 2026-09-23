BEGIN;
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
 IF NOT approve AND nullif(trim(reason),'') IS NULL THEN RAISE EXCEPTION 'Motif de refus obligatoire.'; END IF;
 BEGIN
   SELECT * INTO manager FROM app_profiles WHERE user_id=manager_uid AND company_id=actor.company_id AND is_active AND role='Gestionnaire';
   IF manager.user_id IS NULL THEN RAISE EXCEPTION 'Choisissez un gestionnaire actif de cette entreprise.'; END IF;
   IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(request.payload->'items') LOOP
     IF coalesce(manager.control_scopes->workflow_op(coalesce(item->>'op',request.payload->>'op')),'false'::jsonb)<>'true'::jsonb THEN RAISE EXCEPTION 'Ce gestionnaire ne gère pas tous les stocks du bon. Séparez les demandes par gestionnaire.'; END IF;
     IF approve AND coalesce((item->>'qty')::numeric,0)<=0 THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
   END LOOP;
 END;
 decision := jsonb_build_object('approved',approve,'uid',actor.user_id,'name',actor.profile->>'name','at',now(),'reason',left(trim(reason),1000));
 request.payload := request.payload || jsonb_build_object('validatorDecision',decision,'status',CASE WHEN approve THEN 'EN ATTENTE GESTIONNAIRE' ELSE 'REFUSEE VALIDATEUR' END,'statut',CASE WHEN approve THEN 'EN ATTENTE GESTIONNAIRE' ELSE 'REFUSEE VALIDATEUR' END,'assignedGestionnaireUid',manager.user_id,'assignedGestionnaireName',manager.profile->>'name');
 UPDATE app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES ('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','VALIDATION_BON','requestId',request.payload->>'id','decision',decision,'company_id',actor.company_id));
 RETURN request.payload;
END $$;

CREATE OR REPLACE FUNCTION public.resubmit_stock_request(request_key text, expected_decision jsonb, correction jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; item jsonb; stockrow public.app_records; items jsonb := '[]'; snapshot jsonb; operator text;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Correction réservée au gestionnaire concerné.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon affecté à un autre gestionnaire.'; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'REFUSEE VALIDATEUR' OR request.payload->'validatorDecision' IS DISTINCT FROM expected_decision THEN RAISE EXCEPTION 'Bon déjà modifié. Actualisez la liste.'; END IF;
 IF nullif(trim(correction->>'note'),'') IS NULL THEN RAISE EXCEPTION 'Expliquez la correction effectuée.'; END IF;
 IF jsonb_typeof(correction->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(correction->'items')=0 THEN RAISE EXCEPTION 'Ajoutez au moins un matériel.'; END IF;
 IF correction->>'serviceAbbreviation' IS NULL OR correction->>'serviceAbbreviation' NOT IN ('B2B','DEP','MAIN') THEN RAISE EXCEPTION 'Service requis.'; END IF;
 IF nullif(trim(correction->>'motif'),'') IS NULL OR nullif(trim(correction->>'demandeurName'),'') IS NULL THEN RAISE EXCEPTION 'Motif et destinataire requis.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(correction->'items') LOOP
   SELECT * INTO stockrow FROM app_records WHERE collection='stock' AND record_key=item->>'stockKey' AND company_id=actor.company_id;
   operator:=workflow_op(stockrow.payload->>'op');
   IF stockrow.record_key IS NULL OR coalesce(actor.control_scopes->operator,'false'::jsonb)<>'true'::jsonb
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request.payload->'items') old_item WHERE workflow_op(coalesce(old_item->>'op',request.payload->>'op'))=operator)
     THEN RAISE EXCEPTION 'Matériel hors des stocks dédiés de ce bon.'; END IF;
   IF jsonb_typeof(item->'qty') IS DISTINCT FROM 'number' OR (item->>'qty')::numeric<=0 THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
   items:=items||jsonb_build_array(jsonb_build_object('op',operator,'label',stockrow.payload->>'label','qty',item->'qty','stockKey',stockrow.record_key));
 END LOOP;
 snapshot:=jsonb_build_object('before',request.payload-'correctionHistory','by',actor.user_id,'name',actor.profile->>'name','at',now(),'note',left(trim(correction->>'note'),2000),'afterItems',items);
 request.payload := (request.payload-'validatorDecision'-'technicianSignatureText'-'coordinationSignatureText'-'managerSignatureText'-'technicianSignedAt'-'coordinationSignedAt'-'managerSignedAt'-'validatedAt') || jsonb_build_object(
   'items',items,'motif',left(trim(correction->>'motif'),1000),'demandeurName',left(trim(correction->>'demandeurName'),200),'tech',left(trim(correction->>'demandeurName'),200),
   'equipe',CASE WHEN nullif(request.payload->>'equipe','') IS NOT NULL THEN left(trim(correction->>'demandeurName'),200) ELSE request.payload->>'equipe' END,
   'receptionnaireNom',left(trim(correction->>'demandeurName'),200),
   'serviceAbbreviation',correction->>'serviceAbbreviation','status','EN ATTENTE VALIDATEUR','statut','EN ATTENTE VALIDATEUR',
   'correctionHistory',coalesce(request.payload->'correctionHistory','[]'::jsonb)||jsonb_build_array(snapshot));
 UPDATE app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','CORRECTION_BON','requestId',request.payload->>'id','company_id',actor.company_id,'correction',snapshot));
 RETURN request.payload;
END $$;
REVOKE ALL ON FUNCTION public.resubmit_stock_request(text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resubmit_stock_request(text,jsonb,jsonb) TO authenticated;
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
   IF NEW.payload->>'status' IN ('EN ATTENTE GESTIONNAIRE','REFUSEE VALIDATEUR') THEN
     SELECT recipients || jsonb_build_array(profile->'id') INTO recipients FROM app_profiles WHERE user_id::text=NEW.payload->>'assignedGestionnaireUid';
   END IF;
   message := coalesce(NEW.payload->>'ref',NEW.payload->>'id')||' : '||(NEW.payload->>'status')||coalesce(' — '||(NEW.payload#>>'{validatorDecision,reason}'),'');
 ELSE RETURN NEW;
 END IF;
 FOR recipient IN SELECT value FROM jsonb_array_elements(coalesce(recipients,'[]')) LOOP
   IF recipient='null'::jsonb THEN CONTINUE; END IF;
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,NEW.company_id,jsonb_build_object('id',gen_random_uuid()::text,'company_id',NEW.company_id,'userId',recipient,'message',message,'date',now(),'createdAt',now(),'lu',false,
     'section',CASE WHEN NEW.payload->>'status'='EN ATTENTE VALIDATEUR' THEN 'validation-bons'
       WHEN EXISTS(SELECT 1 FROM app_profiles WHERE company_id=NEW.company_id AND profile->'id'=recipient AND role='Gestionnaire') THEN 'demandes-coordonnatrice' ELSE NULL END));
 END LOOP;
 RETURN NEW;
END $$;
COMMIT;

