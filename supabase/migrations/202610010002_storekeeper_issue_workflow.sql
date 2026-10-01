BEGIN;

-- Magasinier accounts are company wide and have no office or stock scope.
CREATE OR REPLACE FUNCTION public.register_company_user(actor_id uuid,new_user_id uuid,company text,user_role text,user_name text,user_email text,stock_ops text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; scopes jsonb; keys jsonb; profile jsonb; company_record jsonb;
BEGIN
 SELECT * INTO actor FROM public.app_profiles WHERE user_id=actor_id AND is_active;
 IF actor.user_id IS NULL OR actor.role NOT IN ('Superviseur','SUPER_ADMIN') THEN RAISE EXCEPTION 'Création réservée au superviseur.'; END IF;
 IF company IS NULL OR (actor.role<>'SUPER_ADMIN' AND company<>actor.company_id) THEN RAISE EXCEPTION 'Entreprise non autorisée.'; END IF;
 IF user_role IS NULL OR user_role NOT IN ('Gestionnaire','Magasinier','Contrôleur','Coordinateur','Coordinatrice','Superviseur Terrain','Technicien','Validateur','Validatrice') THEN RAISE EXCEPTION 'Rôle non autorisé.'; END IF;
 IF nullif(trim(user_name),'') IS NULL OR length(user_name)>120 THEN RAISE EXCEPTION 'Nom invalide.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=new_user_id AND lower(email)=lower(user_email)) THEN RAISE EXCEPTION 'Identité Auth invalide.'; END IF;
 SELECT payload INTO company_record FROM public.app_records WHERE collection='companies' AND (record_key=company OR payload->>'id'=company) LIMIT 1;
 IF company_record IS NULL AND company='COMP-ITC-LEGACY' THEN company_record:=jsonb_build_object('id',company,'name','ITC','status','active'); END IF;
 IF company_record IS NULL OR company_record->>'status'='suspended' THEN RAISE EXCEPTION 'Entreprise absente ou suspendue.'; END IF;
 IF user_role IN ('Gestionnaire','Validateur','Validatrice') AND coalesce(cardinality(stock_ops),0)=0 THEN RAISE EXCEPTION 'Sélectionnez au moins un stock.'; END IF;
 IF user_role IN ('Contrôleur','Magasinier') THEN stock_ops:=ARRAY[]::text[]; END IF;
 scopes:=public.check_assigned_stocks(company,stock_ops);
 IF user_role='Contrôleur' OR user_role='Magasinier' THEN scopes:='{}'::jsonb; END IF;
 SELECT coalesce(jsonb_object_agg(company||'|'||key,true),'{}'::jsonb) INTO keys FROM jsonb_each(scopes);
 profile:=jsonb_build_object('id',floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,'uid',new_user_id,'email',lower(user_email),'name',trim(user_name),'full_name',trim(user_name),
   'company_id',company,'company_name',company_record->>'name','role',user_role,'managedOps',to_jsonb(stock_ops),'controlScopes',scopes,'controlScopeKeys',keys,
   'stockScopeMode','explicit','is_active',true,'account_status','active','must_change_password',true,'created_at',now(),'created_by',actor_id);
 INSERT INTO public.app_profiles(user_id,company_id,role,control_scopes,control_scope_keys,profile) VALUES(new_user_id,company,user_role,scopes,keys,profile);
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('users',new_user_id::text,company,profile);
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,company,jsonb_build_object('action','CREATE_COMPANY_USER','company_id',company,'target',new_user_id,'role',user_role,'stocks',to_jsonb(stock_ops),'by',actor_id,'date',now()));
 RETURN profile-'email';
END $$;

-- The manager authorizes the bon and signs it; this does not change stock.
CREATE OR REPLACE FUNCTION public.issue_stock_request_signed(request_key text,signer_name text,signature_image text,service text,selections jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; evidence jsonb; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Gestionnaire' THEN RAISE EXCEPTION 'Signature réservée au gestionnaire affecté.'; END IF;
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon hors affectation.'; END IF;
 IF request.payload->>'status' IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI','LIVREE') THEN RETURN request.payload; END IF;
 IF request.payload->>'status' IS DISTINCT FROM 'EN ATTENTE GESTIONNAIRE' OR request.payload#>>'{validatorDecision,approved}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validation du validateur requise.'; END IF;
 IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request.payload->'items')=0 THEN RAISE EXCEPTION 'Bon sans matériel.'; END IF;
 IF length(trim(coalesce(service,'')))=0 THEN RAISE EXCEPTION 'Service émetteur requis.'; END IF;
 IF (actor.control_scopes ? 'ITC-B01' AND service NOT IN ('PROD','MBM','MFTTH','DR','MNM','DESS','LS','CIDATA'))
    OR (NOT (actor.control_scopes ? 'ITC-B01') AND service NOT IN ('B2B','DEP','MAIN')) THEN RAISE EXCEPTION 'Service émetteur invalide pour ce gestionnaire.'; END IF;
 evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
 result:=request.payload||jsonb_build_object('status','EN ATTENTE MAGASINIER','statut','EN ATTENTE MAGASINIER',
   'managerSignatureText',evidence->>'name','managerSignedAt',evidence->'at','managerSignedByUid',actor.user_id,
   'validatedAt',evidence->'at','validatedBy',actor.profile->>'name','validatedById',actor.profile->'id',
   'serviceAbbreviation',service,'materialService',coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb)));
 result:=jsonb_set(result,'{bonSignatures}',coalesce(result->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence),true);
 UPDATE public.app_records SET payload=result,updated_at=now() WHERE collection='demandes' AND record_key=request_key;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','BON_AUTORISE_MAGASINIER','company_id',actor.company_id,'requestKey',request_key,'manager',evidence));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.inspect_stock_bon(bon_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; result jsonb; state text; moment timestamptz:=clock_timestamp(); history jsonb; scan_day text; prior_day jsonb;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Scanner réservé au magasinier.'; END IF;
 IF nullif(trim(bon_id),'') IS NULL OR length(bon_id)>250 THEN RAISE EXCEPTION 'Identifiant du bon invalide.'; END IF;
 IF (SELECT count(*) FROM public.app_records WHERE collection='demandes' AND company_id=actor.company_id AND (record_key=bon_id OR payload->>'id'=bon_id OR payload->>'sortieId'=bon_id))>1 THEN RAISE EXCEPTION 'Identifiant ambigu. Faites vérifier le bon.'; END IF;
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND company_id=actor.company_id AND (record_key=bon_id OR payload->>'id'=bon_id OR payload->>'sortieId'=bon_id) LIMIT 1;
 IF request.record_key IS NULL THEN RAISE EXCEPTION 'Bon inconnu dans votre entreprise.'; END IF;
 result:=request.payload;
 state:=CASE
   WHEN result->>'status'='LIVREE' THEN 'DEJA_LIVRE'
   WHEN result->>'status' LIKE 'REFUS%' OR result->>'status' LIKE 'ANNUL%' THEN 'REFUSE'
   WHEN result->>'status' IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') AND result ? 'managerSignedAt' THEN 'VALIDE'
   WHEN result->>'status'='EN ATTENTE GESTIONNAIRE' THEN 'A_VALIDER'
   ELSE 'A_VALIDER' END;
 scan_day:=to_char(moment AT TIME ZONE 'UTC','YYYY-MM-DD');
 INSERT INTO public.app_settings(company_id,setting_key,value) VALUES(actor.company_id,'derniereDateScan',to_jsonb(scan_day)) ON CONFLICT DO NOTHING;
 SELECT value INTO prior_day FROM public.app_settings WHERE company_id=actor.company_id AND setting_key='derniereDateScan' FOR UPDATE;
 INSERT INTO public.app_settings(company_id,setting_key,value) VALUES(actor.company_id,'scansDuJour','[]') ON CONFLICT DO NOTHING;
 SELECT value INTO history FROM public.app_settings WHERE company_id=actor.company_id AND setting_key='scansDuJour' FOR UPDATE;
 IF prior_day IS DISTINCT FROM to_jsonb(scan_day) OR jsonb_typeof(history) IS DISTINCT FROM 'array' THEN history:='[]'; END IF;
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO history FROM jsonb_array_elements(history) WHERE value->>'id' IS DISTINCT FROM result->>'id';
 history:=jsonb_build_array(jsonb_build_object('id',result->>'id','heure',to_char(moment AT TIME ZONE 'UTC','HH24:MI'),'technicien',coalesce(result->>'demandeurName',result->>'tech'),'state',state,'by',actor.user_id))||history;
 UPDATE public.app_settings SET value=to_jsonb(scan_day),updated_at=now() WHERE company_id=actor.company_id AND setting_key='derniereDateScan';
 UPDATE public.app_settings SET value=history,updated_at=now() WHERE company_id=actor.company_id AND setting_key='scansDuJour';
 RETURN jsonb_build_object('state',state,'checkedAt',moment,'expiresAt',result->'bonValidUntil','createdAt',result->'bonCreatedAt','requestKey',request.record_key,'scansToday',history,
   'canIssue',state='VALIDE','canRequestRenewal',false,'deliveredAt',result->'materialService'->'events'->-1->'at',
   'deliveredBy',result->'materialService'->'events'->-1->>'name','bon',result||jsonb_build_object('_dbKey',request.record_key,'company_id',actor.company_id));
END $$;

CREATE OR REPLACE FUNCTION public.dispense_stock_bon_signed(request_key text,items jsonb,signer_name text,signature_image text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor public.app_profiles; request public.app_records; stockrow public.app_records; selection jsonb; item jsonb; selected_item jsonb;
        service_state jsonb; served_map jsonb; events jsonb; event_items jsonb:='[]'::jsonb; event jsonb; evidence jsonb;
        idx integer; qty numeric; served numeric; requested numeric; op text; stock_key text; stock_count integer; all_served boolean:=true; i integer;
BEGIN
 SELECT * INTO actor FROM public.current_app_profile();
 IF actor.role IS DISTINCT FROM 'Magasinier' THEN RAISE EXCEPTION 'Sortie réservée au magasinier.'; END IF;
 IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items)=0 THEN RAISE EXCEPTION 'Cochez au moins un matériel à remettre.'; END IF;
 IF (SELECT count(DISTINCT (value->>'index')::integer) FROM jsonb_array_elements(items))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Un matériel ne peut être sélectionné qu’une fois.'; END IF;
 SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
 IF request.record_key IS NULL OR request.payload->>'status' NOT IN ('EN ATTENTE MAGASINIER','PARTIELLEMENT SERVI') OR request.payload->>'managerSignedAt' IS NULL THEN RAISE EXCEPTION 'Bon non autorisé au service ou déjà entièrement servi.'; END IF;
 service_state:=coalesce(request.payload->'materialService',jsonb_build_object('servedByItem','{}'::jsonb,'events','[]'::jsonb));
 served_map:=coalesce(service_state->'servedByItem','{}'::jsonb); events:=coalesce(service_state->'events','[]'::jsonb);
 IF jsonb_typeof(request.payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Le bon ne contient aucun article.'; END IF;
 -- Lock stock rows in a stable order so simultaneous cashiers cannot overspend.
 PERFORM 1 FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id ORDER BY record_key FOR UPDATE;
 FOR selection IN SELECT value FROM jsonb_array_elements(items) ORDER BY (value->>'index')::integer LOOP
   idx:=(selection->>'index')::integer; qty:=(selection->>'quantity')::numeric;
   IF idx<0 OR idx>=jsonb_array_length(request.payload->'items') OR qty IS NULL OR qty<=0 THEN RAISE EXCEPTION 'Sélection de matériel invalide.'; END IF;
   item:=request.payload->'items'->idx; requested:=(item->>'qty')::numeric; served:=coalesce(((served_map->(idx::text))->>'qty')::numeric,0);
   IF requested IS NULL OR qty>requested-served THEN RAISE EXCEPTION 'Quantité déjà servie ou supérieure au reliquat pour %.',item->>'label'; END IF;
   op:=public.workflow_op(coalesce(item->>'op',request.payload->>'op')); stock_key:=coalesce(nullif(item->>'stockKey',''),nullif(item->>'_dbKey',''));
   IF stock_key IS NOT NULL THEN
     SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id AND record_key=stock_key FOR UPDATE;
     IF stockrow.record_key IS NULL OR public.workflow_op(coalesce(stockrow.payload->>'op',stockrow.payload->>'operator')) IS DISTINCT FROM op
       OR upper(trim(coalesce(stockrow.payload->>'label',stockrow.payload->>'name',stockrow.payload->>'designation'))) IS DISTINCT FROM upper(trim(item->>'label')) THEN
       RAISE EXCEPTION 'La ligne de stock du matériel % est absente ou a changé.',item->>'label';
     END IF;
   ELSE
     SELECT count(*) INTO stock_count FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id
       AND public.workflow_op(coalesce(payload->>'op',payload->>'operator'))=op
       AND upper(regexp_replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),'[[:space:]]+',' ','g'))
         =upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g'));
     IF stock_count<>1 THEN RAISE EXCEPTION 'Article absent ou ambigu dans le stock : % / %.',op,item->>'label'; END IF;
     SELECT * INTO stockrow FROM public.app_records WHERE collection='stock' AND company_id=actor.company_id
       AND public.workflow_op(coalesce(payload->>'op',payload->>'operator'))=op
       AND upper(regexp_replace(trim(coalesce(payload->>'label',payload->>'name',payload->>'designation')),'[[:space:]]+',' ','g'))
         =upper(regexp_replace(trim(item->>'label'),'[[:space:]]+',' ','g')) FOR UPDATE;
   END IF;
   IF coalesce((stockrow.payload->>'qty')::numeric,0)<qty THEN RAISE EXCEPTION 'Stock insuffisant pour % (disponible : %).',item->>'label',stockrow.payload->>'qty'; END IF;
   UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-qty),true),updated_at=now()
     WHERE collection='stock' AND record_key=stockrow.record_key AND company_id=actor.company_id;
   served:=served+qty;
   served_map:=jsonb_set(served_map,ARRAY[idx::text],jsonb_build_object('qty',served,'lastAt',clock_timestamp(),'stockKey',stockrow.record_key),true);
   event_items:=event_items||jsonb_build_array(jsonb_build_object('index',idx,'label',item->>'label','op',op,'qty',qty,'stockKey',stockrow.record_key));
 END LOOP;
 evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
 event:=jsonb_build_object('at',clock_timestamp(),'uid',actor.user_id,'name',actor.profile->>'name','signature',evidence,'items',event_items);
 events:=events||jsonb_build_array(event);
 FOR i IN 0..jsonb_array_length(request.payload->'items')-1 LOOP
   item:=request.payload->'items'->i; requested:=(item->>'qty')::numeric; served:=coalesce(((served_map->(i::text))->>'qty')::numeric,0);
   IF requested IS NULL OR served<requested THEN all_served:=false; END IF;
 END LOOP;
 service_state:=jsonb_build_object('servedByItem',served_map,'events',events);
 request.payload:=request.payload||jsonb_build_object('materialService',service_state,
   'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('storekeeper',evidence),
   'status',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
   'statut',CASE WHEN all_served THEN 'LIVREE' ELSE 'PARTIELLEMENT SERVI' END,
   'validatedAt',event->'at','validatedBy',actor.profile->>'name','validatedById',actor.profile->'id',
   'dateLivraison',event->'at','sortieId',coalesce(request.payload->>'sortieId',gen_random_uuid()::text));
 UPDATE public.app_records SET payload=request.payload,updated_at=now() WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id;
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('sorties',gen_random_uuid()::text,actor.company_id,
   request.payload||jsonb_build_object('id',gen_random_uuid()::text,'sourceDemandeId',request.payload->>'id','items',event_items,
     'date',event->'at','createdBy',actor.profile->>'name','storekeeperSignature',evidence,'partialIssue',NOT all_served));
 INSERT INTO public.app_records(collection,record_key,company_id,payload) VALUES('platformAuditLogs',gen_random_uuid()::text,actor.company_id,
   jsonb_build_object('action','BON_MATERIEL_SERVI','company_id',actor.company_id,'requestId',request.payload->>'id','event',event,'final',all_served));
 RETURN request.payload;
END $$;

-- A bon signed by its manager may be served later; only the cashier may finish it.
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
 NEW.payload:=NEW.payload||jsonb_build_object('bonCreatedAt',OLD.payload->'bonCreatedAt');
 expires:=public.bon_saved_timestamp(OLD.payload->>'bonValidUntil');
 IF current_user NOT IN ('authenticated','anon') AND NEW.payload->'validatorDecision' IS DISTINCT FROM OLD.payload->'validatorDecision'
   AND NEW.payload#>>'{validatorDecision,approved}'='true' AND NEW.payload->>'status'='EN ATTENTE GESTIONNAIRE'
   AND (expires IS NULL OR expires<=moment) THEN
  renewal:=jsonb_build_object('at',moment,'by',NEW.payload#>>'{validatorDecision,uid}','name',NEW.payload#>>'{validatorDecision,name}','reason','Validation du bon après expiration','previousValidUntil',OLD.payload->'bonValidUntil','validUntil',moment+interval '24 hours');
  NEW.payload:=(NEW.payload-ARRAY['bonRenewalRequestedAt','bonRenewalRequestedBy'])||jsonb_build_object('bonValidUntil',moment+interval '24 hours','bonRenewals',coalesce(OLD.payload->'bonRenewals','[]'::jsonb)||jsonb_build_array(renewal));
 END IF;
 IF NEW.payload->>'status'='LIVREE' AND OLD.payload->>'status' IS DISTINCT FROM 'LIVREE'
   AND OLD.payload->>'managerSignedAt' IS NULL THEN
  IF expires IS NULL OR expires<=moment THEN RAISE EXCEPTION 'Bon expiré : confirmation du validateur rattaché requise avant la remise.'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_guard_bon_validity ON public.app_records;
CREATE TRIGGER zz_guard_bon_validity BEFORE INSERT OR UPDATE ON public.app_records FOR EACH ROW EXECUTE FUNCTION public.guard_bon_validity();

REVOKE ALL ON FUNCTION public.issue_stock_request_signed(text,text,text,text,jsonb),public.inspect_stock_bon(text),public.dispense_stock_bon_signed(text,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_stock_request_signed(text,text,text,text,jsonb),public.inspect_stock_bon(text),public.dispense_stock_bon_signed(text,jsonb,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_validated_request(text,text,text),public.issue_validated_request_before_validity(text,text,text),public.issue_validated_request_substocks(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
