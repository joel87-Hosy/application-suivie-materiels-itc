BEGIN;

CREATE OR REPLACE FUNCTION public.bon_saved_timestamp(value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path=public SET timezone='UTC' AS $$
BEGIN
 IF value ~ '^\d{4}-\d{2}-\d{2}($|T| )' THEN RETURN value::timestamptz; END IF;
 IF value ~ '^\d{1,2}/\d{1,2}/\d{4}($|\D)' THEN
  RETURN to_timestamp(replace(value,',',''),'DD/MM/YYYY HH24:MI:SS');
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Preserve historical creation dates. Unknown dates remain expired until confirmed.
UPDATE public.app_records SET payload=payload||jsonb_build_object(
 'bonCreatedAt',coalesce(bon_saved_timestamp(payload->>'createdAt'),bon_saved_timestamp(payload->>'date'),bon_saved_timestamp(payload->>'enteredAt')),
 'bonValidUntil',coalesce(bon_saved_timestamp(payload->>'createdAt'),bon_saved_timestamp(payload->>'date'),bon_saved_timestamp(payload->>'enteredAt'))+interval '24 hours')
WHERE collection='demandes' AND NOT payload ? 'bonCreatedAt';

CREATE OR REPLACE FUNCTION public.guard_bon_validity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE expires timestamptz; moment timestamptz:=clock_timestamp(); renewal jsonb;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  NEW.payload:=(NEW.payload-ARRAY['bonRenewals','bonRenewalRequestedAt','bonRenewalRequestedBy'])||jsonb_build_object('bonCreatedAt',moment,'bonValidUntil',moment+interval '24 hours');
  RETURN NEW;
 END IF;
 IF current_user IN ('authenticated','anon') AND
   (NEW.payload->'bonCreatedAt' IS DISTINCT FROM OLD.payload->'bonCreatedAt' OR NEW.payload->'bonValidUntil' IS DISTINCT FROM OLD.payload->'bonValidUntil' OR NEW.payload->'bonRenewals' IS DISTINCT FROM OLD.payload->'bonRenewals' OR NEW.payload->'bonRenewalRequestedAt' IS DISTINCT FROM OLD.payload->'bonRenewalRequestedAt' OR NEW.payload->'bonRenewalRequestedBy' IS DISTINCT FROM OLD.payload->'bonRenewalRequestedBy') THEN
  RAISE EXCEPTION 'La validité du bon est gérée par le serveur et le validateur.';
 END IF;
 -- Corrections and reprints never change the creation timestamp.
 NEW.payload:=NEW.payload||jsonb_build_object('bonCreatedAt',OLD.payload->'bonCreatedAt');
 expires:=bon_saved_timestamp(OLD.payload->>'bonValidUntil');
 -- A first approval made after expiration is itself an explicit confirmation.
 IF current_user NOT IN ('authenticated','anon') AND NEW.payload->'validatorDecision' IS DISTINCT FROM OLD.payload->'validatorDecision'
 AND NEW.payload#>>'{validatorDecision,approved}'='true' AND NEW.payload->>'status'='EN ATTENTE GESTIONNAIRE'
 AND (expires IS NULL OR expires<=moment) THEN
  renewal:=jsonb_build_object('at',moment,'by',NEW.payload#>>'{validatorDecision,uid}','name',NEW.payload#>>'{validatorDecision,name}','reason','Validation du bon après expiration','previousValidUntil',OLD.payload->'bonValidUntil','validUntil',moment+interval '24 hours');
  NEW.payload:=(NEW.payload-ARRAY['bonRenewalRequestedAt','bonRenewalRequestedBy'])||jsonb_build_object('bonValidUntil',moment+interval '24 hours','bonRenewals',coalesce(OLD.payload->'bonRenewals','[]'::jsonb)||jsonb_build_array(renewal));
 END IF;
 IF NEW.payload->>'status'='LIVREE' AND OLD.payload->>'status' IS DISTINCT FROM 'LIVREE' THEN
  IF expires IS NULL OR expires<=moment THEN RAISE EXCEPTION 'Bon expiré : confirmation du validateur rattaché requise avant la remise.'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_guard_bon_validity ON public.app_records;
CREATE TRIGGER zz_guard_bon_validity BEFORE INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_bon_validity();

-- Keep the existing stock transaction behind a non-public, checked entry point.
DO $$ BEGIN
 IF to_regprocedure('public.issue_validated_request_before_validity(text,text,text)') IS NULL THEN
  ALTER FUNCTION public.issue_validated_request(text,text,text) RENAME TO issue_validated_request_before_validity;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.issue_validated_request_before_validity(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.issue_validated_request(request_key text, signature text, service text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; request app_records; expires timestamptz;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Gestionnaire actif requis.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon hors de votre affectation.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 IF EXISTS(SELECT 1 FROM app_records WHERE collection='sorties' AND company_id=actor.company_id AND payload->>'sourceDemandeId'=request.payload->>'id') THEN RAISE EXCEPTION 'Bon déjà utilisé : aucune seconde remise autorisée.'; END IF;
 expires:=bon_saved_timestamp(request.payload->>'bonValidUntil');
 IF expires IS NULL OR expires<=clock_timestamp() THEN RAISE EXCEPTION 'Bon expiré : confirmation du validateur rattaché requise.'; END IF;
 RETURN issue_validated_request_before_validity(request_key,signature,service);
END $$;
REVOKE ALL ON FUNCTION public.issue_validated_request(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_validated_request(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.inspect_stock_bon(bon_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; request app_records; issued app_records; result jsonb; state text; expires timestamptz; moment timestamptz:=clock_timestamp(); history jsonb; scan_day text; prior_day jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Scanner réservé au gestionnaire actif.'; END IF;
 IF nullif(trim(bon_id),'') IS NULL OR length(bon_id)>250 THEN RAISE EXCEPTION 'Identifiant du bon invalide.'; END IF;
 IF (SELECT count(*) FROM app_records WHERE collection='demandes' AND company_id=actor.company_id AND (record_key=bon_id OR payload->>'id'=bon_id OR payload->>'sortieId'=bon_id))>1 THEN RAISE EXCEPTION 'Identifiant ambigu. Faites vérifier le bon.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND company_id=actor.company_id AND (record_key=bon_id OR payload->>'id'=bon_id OR payload->>'sortieId'=bon_id) LIMIT 1;
 IF request.record_key IS NULL THEN
  SELECT * INTO issued FROM app_records WHERE collection='sorties' AND company_id=actor.company_id AND (record_key=bon_id OR payload->>'id'=bon_id) LIMIT 1;
  IF issued.record_key IS NOT NULL THEN
   SELECT * INTO request FROM app_records WHERE collection='demandes' AND company_id=actor.company_id AND payload->>'id'=issued.payload->>'sourceDemandeId' LIMIT 1;
  END IF;
 ELSE
  SELECT * INTO issued FROM app_records WHERE collection='sorties' AND company_id=actor.company_id AND (payload->>'sourceDemandeId'=request.payload->>'id' OR record_key=request.payload->>'sortieId') LIMIT 1;
 END IF;
 IF request.record_key IS NULL AND issued.record_key IS NULL THEN RAISE EXCEPTION 'Bon inconnu dans votre entreprise. Aucune remise autorisée.'; END IF;
 result:=coalesce(request.payload,issued.payload);
 IF NOT validator_covers_request(actor.control_scopes,result) THEN RAISE EXCEPTION 'Bon hors de vos stocks attribués.'; END IF;
 expires:=bon_saved_timestamp(result->>'bonValidUntil');
 state:=CASE WHEN issued.record_key IS NOT NULL OR result->>'status' IN ('LIVREE','LIVRÉE') OR result->>'statut' IN ('LIVREE','LIVRÉE') THEN 'DEJA_LIVRE'
  WHEN result->>'status' LIKE 'REFUS%' OR result->>'status' LIKE 'ANNUL%' THEN 'REFUSE'
  WHEN expires IS NULL OR expires<=moment THEN 'EXPIRE'
  WHEN result->>'status'='EN ATTENTE GESTIONNAIRE' AND result#>>'{validatorDecision,approved}'='true' THEN 'VALIDE'
  ELSE 'A_VALIDER' END;
 scan_day:=to_char(moment AT TIME ZONE 'UTC','YYYY-MM-DD');
 INSERT INTO app_settings(company_id,setting_key,value) VALUES(actor.company_id,'derniereDateScan',to_jsonb(scan_day)) ON CONFLICT DO NOTHING;
 SELECT value INTO prior_day FROM app_settings WHERE company_id=actor.company_id AND setting_key='derniereDateScan' FOR UPDATE;
 INSERT INTO app_settings(company_id,setting_key,value) VALUES(actor.company_id,'scansDuJour','[]') ON CONFLICT DO NOTHING;
 SELECT value INTO history FROM app_settings WHERE company_id=actor.company_id AND setting_key='scansDuJour' FOR UPDATE;
 IF prior_day IS DISTINCT FROM to_jsonb(scan_day) OR jsonb_typeof(history) IS DISTINCT FROM 'array' THEN history:='[]'; END IF;
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO history FROM jsonb_array_elements(history) WHERE value->>'id' IS DISTINCT FROM result->>'id';
 history:=jsonb_build_array(jsonb_build_object('id',result->>'id','heure',to_char(moment AT TIME ZONE 'UTC','HH24:MI'),'technicien',coalesce(result->>'demandeurName',result->>'tech'),'state',state,'by',actor.user_id))||history;
 UPDATE app_settings SET value=to_jsonb(scan_day),updated_at=now() WHERE company_id=actor.company_id AND setting_key='derniereDateScan';
 UPDATE app_settings SET value=history,updated_at=now() WHERE company_id=actor.company_id AND setting_key='scansDuJour';
 RETURN jsonb_build_object('state',state,'checkedAt',moment,'expiresAt',expires,'createdAt',result->'bonCreatedAt','requestKey',request.record_key,'scansToday',history,
  'canIssue',state='VALIDE' AND result->>'assignedGestionnaireUid'=actor.user_id::text,
  'canRequestRenewal',state='EXPIRE' AND result->>'status'='EN ATTENTE GESTIONNAIRE' AND result->>'assignedGestionnaireUid'=actor.user_id::text,
  'deliveredAt',coalesce(issued.payload->'managerSignedAt',result->'managerSignedAt',issued.payload->'date',result->'dateLivraison'),
  'deliveredBy',coalesce(issued.payload->'validatedBy',result->'validatedBy'),
  'bon',result||jsonb_build_object('_dbKey',coalesce(request.record_key,issued.record_key)));
END $$;

CREATE OR REPLACE FUNCTION public.request_bon_renewal(request_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; request app_records; target app_profiles;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Gestionnaire requis.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text OR NOT validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre affectation.'; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' THEN RAISE EXCEPTION 'Ce bon ne peut pas être renouvelé.'; END IF;
 IF bon_saved_timestamp(request.payload->>'bonValidUntil')>clock_timestamp() THEN RAISE EXCEPTION 'Ce bon est encore valide.'; END IF;
 SELECT * INTO target FROM app_profiles WHERE user_id::text=request.payload#>>'{validatorDecision,uid}' AND company_id=actor.company_id AND is_active AND role IN ('Validateur','Validatrice') AND validator_covers_request(control_scopes,request.payload);
 IF target.user_id IS NULL THEN RAISE EXCEPTION 'Validateur rattaché indisponible. Contactez le superviseur.'; END IF;
 IF request.payload ? 'bonRenewalRequestedAt' THEN RETURN; END IF;
 UPDATE app_records SET payload=payload||jsonb_build_object('bonRenewalRequestedAt',clock_timestamp(),'bonRenewalRequestedBy',actor.user_id),updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('id',gen_random_uuid()::text,'company_id',actor.company_id,'userId',target.profile->'id','section','validation-bons','lu',false,'date',now(),'message','BON EXPIRÉ À CONFIRMER : '||coalesce(request.payload->>'ref',request.payload->>'id')));
END $$;

CREATE OR REPLACE FUNCTION public.confirm_bon_renewal(request_key text, expected_valid_until jsonb, approve boolean, reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; request app_records; result jsonb; entry jsonb; moment timestamptz:=clock_timestamp(); recipient jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS NULL OR actor.role NOT IN ('Validateur','Validatrice') THEN RAISE EXCEPTION 'Confirmation réservée au validateur rattaché.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload#>>'{validatorDecision,uid}' IS DISTINCT FROM actor.user_id::text OR NOT validator_covers_request(actor.control_scopes,request.payload) THEN RAISE EXCEPTION 'Bon hors de votre affectation de validation.'; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR NOT request.payload ? 'bonRenewalRequestedAt' THEN RAISE EXCEPTION 'Bon déjà traité ou confirmation non demandée.'; END IF;
 IF coalesce(request.payload->'bonValidUntil','null'::jsonb) IS DISTINCT FROM coalesce(expected_valid_until,'null'::jsonb) OR bon_saved_timestamp(request.payload->>'bonValidUntil')>moment THEN RAISE EXCEPTION 'Validité modifiée. Actualisez la liste.'; END IF;
 IF approve IS NULL OR nullif(trim(reason),'') IS NULL OR length(reason)>1000 THEN RAISE EXCEPTION 'Décision et observation requises (1000 caractères maximum).'; END IF;
 entry:=jsonb_build_object('at',moment,'by',actor.user_id,'name',actor.profile->>'name','approved',approve,'reason',trim(reason),'previousValidUntil',request.payload->'bonValidUntil','validUntil',CASE WHEN approve THEN to_jsonb(moment+interval '24 hours') ELSE request.payload->'bonValidUntil' END);
 result:=(request.payload-ARRAY['bonRenewalRequestedAt','bonRenewalRequestedBy'])||jsonb_build_object('bonRenewals',coalesce(request.payload->'bonRenewals','[]'::jsonb)||jsonb_build_array(entry));
 IF approve THEN result:=result||jsonb_build_object('bonValidUntil',moment+interval '24 hours');
 ELSE result:=result||jsonb_build_object('status','REFUSEE VALIDATEUR','statut','REFUSEE VALIDATEUR','validatorDecision',jsonb_build_object('uid',actor.user_id,'name',actor.profile->>'name','at',moment,'approved',false,'reason',trim(reason))); END IF;
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','BON_RENEWAL','company_id',actor.company_id,'requestId',request.payload->>'id','decision',entry));
 SELECT profile->'id' INTO recipient FROM app_profiles WHERE user_id::text=request.payload->>'assignedGestionnaireUid' AND company_id=actor.company_id;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('notifications',gen_random_uuid()::text,actor.company_id,jsonb_build_object('id',gen_random_uuid()::text,'company_id',actor.company_id,'userId',recipient,'section','demandes-coordonnatrice','lu',false,'date',now(),'message',CASE WHEN approve THEN 'BON RENOUVELÉ POUR 24 H : ' ELSE 'RENOUVELLEMENT REFUSÉ : ' END||coalesce(request.payload->>'ref',request.payload->>'id')));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.inspect_stock_bon(text),public.request_bon_renewal(text),public.confirm_bon_renewal(text,jsonb,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inspect_stock_bon(text),public.request_bon_renewal(text),public.confirm_bon_renewal(text,jsonb,boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
