BEGIN;
-- Recover old rejections only where exactly one active manager owns every stock.
-- Ambiguous requests remain untouched rather than granting the wrong manager access.
DO $$
DECLARE request public.app_records; manager public.app_profiles; candidates uuid[];
BEGIN
 FOR request IN SELECT * FROM app_records WHERE collection='demandes'
   AND payload->>'status'='REFUSEE VALIDATEUR'
   AND nullif(payload->>'assignedGestionnaireUid','') IS NULL FOR UPDATE LOOP
   SELECT array_agg(user_id) INTO candidates FROM app_profiles
     WHERE company_id=request.company_id AND is_active AND role='Gestionnaire'
       AND validator_covers_request(control_scopes,request.payload);
   IF coalesce(array_length(candidates,1),0)<>1 THEN CONTINUE; END IF;
   SELECT * INTO manager FROM app_profiles WHERE user_id=candidates[1];
   UPDATE app_records SET payload=payload||jsonb_build_object('assignedGestionnaireUid',manager.user_id,'assignedGestionnaireName',manager.profile->>'name'),updated_at=now()
     WHERE collection='demandes' AND record_key=request.record_key;
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,request.company_id,
     jsonb_build_object('userId',manager.profile->'id','company_id',request.company_id,'section','demandes-coordonnatrice','lu',false,'date',now(),'createdAt',now(),
     'message','Ancien bon à corriger : '||coalesce(request.payload->>'ref',request.payload->>'id',request.record_key)||' — '||coalesce(request.payload#>>'{validatorDecision,reason}','Motif non renseigné')));
   INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,request.company_id,
     jsonb_build_object('action','RECOVER_REJECTED_BON','requestKey',request.record_key,'assignedGestionnaireUid',manager.user_id,'company_id',request.company_id,'date',now()));
 END LOOP;
END $$;
COMMIT;
