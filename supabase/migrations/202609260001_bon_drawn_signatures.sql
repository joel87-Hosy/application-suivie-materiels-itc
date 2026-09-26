BEGIN;
CREATE OR REPLACE FUNCTION public.bon_signature_evidence(signer_name text, signature_image text, actor public.app_profiles) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE bytes bytea; width bigint; height bigint;
BEGIN
 IF actor.user_id IS NULL OR NOT actor.is_active THEN RAISE EXCEPTION 'Signataire actif requis.'; END IF;
 IF nullif(trim(signer_name),'') IS NULL OR length(trim(signer_name))>120 THEN RAISE EXCEPTION 'Nom du signataire requis (120 caractères maximum).'; END IF;
 IF signature_image IS NOT NULL THEN
  IF length(signature_image)>100000 OR signature_image !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' THEN RAISE EXCEPTION 'Signature PNG invalide ou trop volumineuse.'; END IF;
  bytes:=decode(substr(signature_image,23),'base64');
  IF length(bytes)<67 OR encode(substring(bytes FROM 1 FOR 8),'hex')<>'89504e470d0a1a0a' OR encode(substring(bytes FROM 9 FOR 8),'hex')<>'0000000d49484452' OR encode(substring(bytes FROM length(bytes)-11 FOR 12),'hex')<>'0000000049454e44ae426082' THEN RAISE EXCEPTION 'Image PNG requise.'; END IF;
  width:=get_byte(bytes,16)::bigint*16777216+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19);
  height:=get_byte(bytes,20)::bigint*16777216+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23);
  IF width NOT BETWEEN 1 AND 1024 OR height NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'Dimensions de signature invalides.'; END IF;
 END IF;
 RETURN jsonb_build_object('name',trim(signer_name),'image',signature_image,'uid',actor.user_id,'at',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.bon_signature_evidence(text,text,public.app_profiles) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guard_bon_signatures() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE actor app_profiles; previous jsonb; signatures jsonb; part text; evidence jsonb; owner_record jsonb;
BEGIN
 IF NEW.collection<>'demandes' THEN RETURN NEW; END IF;
 previous:=CASE WHEN TG_OP='UPDATE' THEN coalesce(OLD.payload->'bonSignatures','{}'::jsonb) ELSE '{}'::jsonb END;
 IF TG_OP='UPDATE' AND NEW.payload->'correctionHistory' IS DISTINCT FROM OLD.payload->'correctionHistory' THEN
  IF current_user IN ('authenticated','anon') THEN RAISE EXCEPTION 'Utilisez la correction du bon pour modifier son historique.'; END IF;
  -- The previous signatures already live in correctionHistory.before.
  NEW.payload:=NEW.payload-'bonSignatures';RETURN NEW;
 END IF;
 signatures:=coalesce(NEW.payload->'bonSignatures','{}'::jsonb);
 IF signatures=previous THEN RETURN NEW; END IF;
 IF jsonb_typeof(signatures) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Signatures invalides.'; END IF;
 IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 SELECT * INTO actor FROM current_app_profile();
 owner_record:=CASE WHEN TG_OP='UPDATE' THEN OLD.payload ELSE NEW.payload END;
 IF actor.company_id IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'Signature hors entreprise.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(signatures) k WHERE k NOT IN ('technician','coordination','validator','manager')) THEN RAISE EXCEPTION 'Zone de signature inconnue.'; END IF;
 FOREACH part IN ARRAY ARRAY['technician','coordination','validator','manager'] LOOP
  IF signatures->part IS NOT DISTINCT FROM previous->part THEN CONTINUE; END IF;
  IF part='technician' THEN
   IF actor.role IS DISTINCT FROM 'Technicien' OR NEW.payload->>'status' IS DISTINCT FROM 'EN ATTENTE COORDINATION' OR owner_record->>'technicienUid' IS DISTINCT FROM coalesce(actor.firebase_uid,actor.user_id::text) THEN RAISE EXCEPTION 'Signature réservée au technicien du bon.'; END IF;
  ELSIF part='coordination' THEN
   IF actor.role IS NULL OR actor.role NOT IN ('Coordinateur','Coordinatrice','Superviseur','Superviseur Terrain') OR (TG_OP='UPDATE' AND OLD.payload->>'status' IS DISTINCT FROM 'EN ATTENTE COORDINATION') OR (owner_record->>'coordinateurId' IS NOT NULL AND owner_record->>'coordinateurId' IS DISTINCT FROM actor.profile->>'id') THEN RAISE EXCEPTION 'Signature réservée à la coordination rattachée.'; END IF;
  ELSE RAISE EXCEPTION 'Utilisez la validation ou la remise signée.';
  END IF;
  evidence:=bon_signature_evidence(signatures#>>ARRAY[part,'name'],signatures#>>ARRAY[part,'image'],actor);
  signatures:=jsonb_set(signatures,ARRAY[part],evidence);
  NEW.payload:=NEW.payload||jsonb_build_object(CASE WHEN part='technician' THEN 'technicianSignatureText' ELSE 'coordinationSignatureText' END,evidence->>'name',CASE WHEN part='technician' THEN 'technicianSignedAt' ELSE 'coordinationSignedAt' END,evidence->'at');
 END LOOP;
 NEW.payload:=NEW.payload||jsonb_build_object('bonSignatures',signatures);
 RETURN NEW;
END $$;
-- Invoker trigger needs the validator helper, but does not grant cross-account signing.
GRANT EXECUTE ON FUNCTION public.bon_signature_evidence(text,text,public.app_profiles) TO authenticated;
DROP TRIGGER IF EXISTS zy_guard_bon_signatures ON public.app_records;
CREATE TRIGGER zy_guard_bon_signatures BEFORE INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_bon_signatures();

CREATE OR REPLACE FUNCTION public.decide_stock_request_signed(request_key text, approve boolean, manager_uid uuid, reason text, signer_name text, signature_image text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; evidence jsonb; result jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 evidence:=bon_signature_evidence(signer_name,signature_image,actor);
 PERFORM decide_stock_request(request_key,approve,manager_uid,reason);
 UPDATE app_records SET payload=payload||jsonb_build_object('bonSignatures',coalesce(payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('validator',evidence)),updated_at=now()
 WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id RETURNING payload INTO result;
 INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,jsonb_build_object('action','BON_SIGNATURE','role','validator','requestKey',request_key,'evidence',evidence,'company_id',actor.company_id));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.issue_stock_request_signed(request_key text, signer_name text, signature_image text, service text, selections jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; request app_records; evidence jsonb; result jsonb;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Signature réservée au gestionnaire.'; END IF;
 SELECT * INTO request FROM app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon hors affectation.'; END IF;
 IF request.payload->>'status'='LIVREE' THEN RETURN request.payload; END IF;
 evidence:=bon_signature_evidence(signer_name,signature_image,actor);
 UPDATE app_records SET payload=payload||jsonb_build_object('bonSignatures',coalesce(payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence)),updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 IF selections IS NULL THEN result:=issue_validated_request(request_key,signer_name,service);
 ELSE result:=issue_validated_request_substocks(request_key,signer_name,service,selections); END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_bon_renewal_signed(request_key text, expected_valid_until jsonb, approve boolean, reason text, signer_name text, signature_image text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor app_profiles; evidence jsonb; result jsonb; previous jsonb; last_index text;
BEGIN
 SELECT * INTO actor FROM current_app_profile();
 evidence:=bon_signature_evidence(signer_name,signature_image,actor);
 result:=confirm_bon_renewal(request_key,expected_valid_until,approve,reason);
 previous:=result#>'{bonSignatures,validator}';
 last_index:=(jsonb_array_length(result->'bonRenewals')-1)::text;
 result:=jsonb_set(result,ARRAY['bonRenewals',last_index],(result#>ARRAY['bonRenewals',last_index])||jsonb_build_object('signature',evidence,'previousSignature',previous));
 result:=result||jsonb_build_object('bonSignatures',coalesce(result->'bonSignatures','{}'::jsonb)||jsonb_build_object('validator',evidence));
 UPDATE app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.decide_stock_request_signed(text,boolean,uuid,text,text,text),public.issue_stock_request_signed(text,text,text,text,jsonb),public.confirm_bon_renewal_signed(text,jsonb,boolean,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_stock_request_signed(text,boolean,uuid,text,text,text),public.issue_stock_request_signed(text,text,text,text,jsonb),public.confirm_bon_renewal_signed(text,jsonb,boolean,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
