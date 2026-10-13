const fs=require('node:fs');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');

const storekeeperUid='00000000-0000-0000-0000-000000000001';
const managerUid='00000000-0000-0000-0000-000000000002';
const bureau01ManagerUid='00000000-0000-0000-0000-000000000003';

(async()=>{
 const db=new PGlite();
 await db.exec(`
  CREATE ROLE authenticated;CREATE ROLE anon;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
  CREATE TABLE public.app_profiles(user_id uuid PRIMARY KEY,role text,company_id text,control_scopes jsonb,profile jsonb);
  CREATE TABLE public.app_records(collection text,record_key text,company_id text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(collection,record_key));
  GRANT SELECT ON public.app_records TO authenticated;
  CREATE FUNCTION public.current_app_profile() RETURNS public.app_profiles LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.app_profiles WHERE user_id=auth.uid() $$;
  CREATE FUNCTION public.storekeeper_covers_request(details jsonb,scopes jsonb,company text,request jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
   SELECT company=request->>'company_id' AND details->>'uid'=request->>'assignedMagasinierUid' AND details->>'office'=request->>'originOffice'
  $$;
  CREATE FUNCTION public.workflow_op(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(trim(value)) $$;
  CREATE FUNCTION public.bon_saved_timestamp(value text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT value::timestamptz $$;
  CREATE FUNCTION public.bon_signature_evidence(signer_name text,signature_image text,actor public.app_profiles) RETURNS jsonb LANGUAGE sql STABLE AS $$
   SELECT jsonb_strip_nulls(jsonb_build_object('name',signer_name,'image',signature_image,'uid',actor.user_id,'at',clock_timestamp()))
  $$;
  CREATE FUNCTION public.inspect_stock_bon_unscoped(bon_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
   SELECT jsonb_build_object('bon',payload,'requestKey',bon_id,'checkedAt',clock_timestamp()) FROM public.app_records
   WHERE collection='demandes' AND record_key=bon_id
  $$;
  CREATE FUNCTION public.issue_validated_request_before_validity(request_key text,signature text,service text) RETURNS jsonb
   LANGUAGE plpgsql SECURITY DEFINER AS $$
   DECLARE actor public.app_profiles; request public.app_records; item jsonb; result jsonb;
   BEGIN
    SELECT * INTO actor FROM public.current_app_profile();
    SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
    IF request.record_key IS NULL OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Bon affecté à un autre gestionnaire.'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(request.payload->'items') LOOP
     UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-(item->>'qty')::numeric),true)
      WHERE collection='stock' AND company_id=actor.company_id AND payload->>'label'=item->>'label';
    END LOOP;
    result:=request.payload||jsonb_build_object('status','LIVREE','statut','LIVREE','managerSignedAt',clock_timestamp(),
      'managerSignatureText',signature,'validatedAt',clock_timestamp(),'validatedBy',actor.profile->>'name');
    UPDATE public.app_records SET payload=result WHERE collection='demandes' AND record_key=request_key;
    RETURN result;
   END $$;
  CREATE FUNCTION public.issue_stock_request_signed_storekeeper(request_key text,signer_name text,signature_image text,service text,selections jsonb) RETURNS jsonb
   LANGUAGE plpgsql SECURITY DEFINER AS $$
   DECLARE actor public.app_profiles; request public.app_records; evidence jsonb; result jsonb;
   BEGIN
    SELECT * INTO actor FROM public.current_app_profile();
    SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
    IF actor.role IS DISTINCT FROM 'Gestionnaire' OR request.payload->>'assignedGestionnaireUid' IS DISTINCT FROM actor.user_id::text THEN RAISE EXCEPTION 'Gestionnaire non affecté.'; END IF;
    evidence:=public.bon_signature_evidence(signer_name,signature_image,actor);
    result:=request.payload||jsonb_build_object('status','EN ATTENTE MAGASINIER','managerSignedAt',clock_timestamp(),
      'managerSignedByUid',actor.user_id,'managerSignatureText',signer_name,
      'bonSignatures',coalesce(request.payload->'bonSignatures','{}'::jsonb)||jsonb_build_object('manager',evidence));
    UPDATE public.app_records SET payload=result WHERE collection='demandes' AND record_key=request_key;
    RETURN result;
   END $$;
  CREATE FUNCTION public.debit_manager_approved_bon(request_key text,service text) RETURNS jsonb
   LANGUAGE plpgsql SECURITY DEFINER AS $$
   DECLARE actor public.app_profiles; request public.app_records; item jsonb; stockrow public.app_records; result jsonb;
   BEGIN
    SELECT * INTO actor FROM public.current_app_profile();
    SELECT * INTO request FROM public.app_records WHERE collection='demandes' AND record_key=request_key AND company_id=actor.company_id FOR UPDATE;
    FOR item IN SELECT value FROM jsonb_array_elements(request.payload->'items') LOOP
     UPDATE public.app_records SET payload=jsonb_set(payload,'{qty}',to_jsonb((payload->>'qty')::numeric-(item->>'qty')::numeric),true)
      WHERE collection='stock' AND record_key='stock-1' AND company_id=actor.company_id;
    END LOOP;
    result:=request.payload||jsonb_build_object('managerDebitAt',clock_timestamp(),'stockDebitSource','GESTIONNAIRE');
    UPDATE public.app_records SET payload=result WHERE collection='demandes' AND record_key=request_key;
    RETURN result;
   END $$;
  INSERT INTO public.app_profiles VALUES
   ('${storekeeperUid}','Magasinier','COMPANY-A','{"ITC-B01":true}','{"uid":"${storekeeperUid}","name":"Magasinier Test","office":"B01"}'),
   ('${managerUid}','Gestionnaire','COMPANY-A','{"ITC-B01":true,"ITC-B02":true}','{"uid":"${managerUid}","name":"Gestionnaire Test","office":"B02"}'),
   ('${bureau01ManagerUid}','Gestionnaire','COMPANY-A','{"ITC-B01":true}','{"uid":"${bureau01ManagerUid}","name":"Gestionnaire B01","office":"B01"}');
 `);

 const initialMigration=fs.readFileSync('supabase/migrations/202610080010_storekeeper_signs_without_manager.sql','utf8').replace(/^\uFEFF/,'');
 await db.exec(initialMigration);
 const correctionMigration=fs.readFileSync('supabase/migrations/202610140001_storekeeper_handover_without_debit.sql','utf8').replace(/^\uFEFF/,'');
 await db.exec(correctionMigration);
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock','stock-1','COMPANY-A',$1)",[
  {op:'ITC-B01',label:'CABLE',qty:4}
 ]);
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock','stock-b01','COMPANY-A',$1)",[
  {op:'ITC-B01',label:'B01 CABLE',qty:5}
 ]);
 const readyBon={
  id:'BON-PRE-MANAGER-HANDOVER',company_id:'COMPANY-A',originOffice:'B01',assignedMagasinierUid:storekeeperUid,
  assignedGestionnaireUid:managerUid,status:'EN ATTENTE GESTIONNAIRE',
  bonValidUntil:'2099-01-01T00:00:00Z',validatorDecision:{approved:true,name:'Validateur'},items:[{op:'ITC-B01',label:'CABLE',qty:2}],
 };
 const partialBon={...readyBon,id:'BON-PARTIAL-PRE-MANAGER',items:[{op:'ITC-B01',label:'CABLE',qty:2}]};
 const pendingBon={...readyBon,id:'BON-WAITING-VALIDATOR',validatorDecision:{approved:false,name:'Validateur'}};
 const expiredBon={...readyBon,id:'BON-EXPIRED',bonValidUntil:'2000-01-01T00:00:00Z'};
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes','request-ready','COMPANY-A',$1),('demandes','request-partial','COMPANY-A',$2),('demandes','request-pending','COMPANY-A',$3),('demandes','request-expired','COMPANY-A',$4)",[readyBon,partialBon,pendingBon,expiredBon]);
 await db.query("SELECT set_config('test.uid',$1,false)",[storekeeperUid]);
 await db.exec('SET ROLE authenticated');

 const scan=(await db.query("SELECT inspect_stock_bon('request-ready') result")).rows[0].result;
 assert.equal(scan.state,'VALIDE');
 assert.equal(scan.canIssue,true,'validator approval allows physical handover before manager signature');
 const expiredScan=(await db.query("SELECT inspect_stock_bon('request-expired') result")).rows[0].result;
 assert.equal(expiredScan.state,'EXPIRE');
 assert.equal(expiredScan.canIssue,false,'expired bons cannot be served');
 await assert.rejects(
  db.query("SELECT dispense_stock_bon_signed_v2('request-pending',$1,'[]','Magasinier Test',NULL)",[[{index:0,quantity:2}]]),
  /Bon non validé/
 );
 await assert.rejects(
  db.query("SELECT dispense_stock_bon_signed_v2('request-expired',$1,'[]','Magasinier Test',NULL)",[[{index:0,quantity:2}]]),
  /Bon expiré/
 );
 const handover=(await db.query("SELECT dispense_stock_bon_signed_v2('request-ready',$1,'[]','Magasinier Test',NULL) result",[[{index:0,quantity:2}]])).rows[0].result;
 assert.equal(handover.status,'EN ATTENTE GESTIONNAIRE','full handover must remain in the manager queue');
 assert.equal(handover.storekeeperHandoverPendingManager,true);
 assert.equal(handover.materialService.servedByItem['0'].qty,2);
 assert.equal(handover.bonSignatures.storekeeper.name,'Magasinier Test');
 assert.equal(handover.bonSignatures.manager,undefined);
 assert.equal(handover.managerSignedAt,undefined);
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-1'")).rows[0].qty,'4','storekeeper handover never debits stock');
 assert.equal((await db.query("SELECT count(*)::int count FROM app_records WHERE collection='stockMovements'")).rows[0].count,0,'storekeeper handover never writes a stock movement');

 await db.query("SELECT set_config('test.uid',$1,false)",[managerUid]);
 const completed=(await db.query("SELECT issue_stock_request_signed('request-ready','Gestionnaire Test',NULL,'B2B',NULL) result")).rows[0].result;
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-1'")).rows[0].qty,'2','manager signature is the stock debit point');
 assert.equal(completed.status,'LIVREE','manager signature completes a bon already fully handed over');
 assert.equal(completed.managerDebitAt!==undefined,true);
 assert.equal(completed.storekeeperHandoverPendingManager,false);
 assert.equal(completed.bonSignatures.storekeeper.name,'Magasinier Test');
 assert.equal(completed.bonSignatures.manager.name,'Gestionnaire Test');

 await db.query("SELECT set_config('test.uid',$1,false)",[storekeeperUid]);
 const partial=(await db.query("SELECT dispense_stock_bon_signed_v2('request-partial',$1,'[]','Magasinier Test',NULL) result",[[{index:0,quantity:1}]])).rows[0].result;
 assert.equal(partial.status,'EN ATTENTE GESTIONNAIRE');
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-1'")).rows[0].qty,'2','partial handover before manager signature leaves stock unchanged');

 await db.query("SELECT set_config('test.uid',$1,false)",[managerUid]);
 const signedPartial=(await db.query("SELECT issue_stock_request_signed('request-partial','Gestionnaire Test',NULL,'B2B',NULL) result")).rows[0].result;
 assert.equal(signedPartial.status,'PARTIELLEMENT SERVI','manager is shown the already handed-over quantity after signing');
 assert.equal(signedPartial.materialService.servedByItem['0'].qty,1);
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-1'")).rows[0].qty,'0','manager signature alone debits the requested stock');

 await db.query("SELECT set_config('test.uid',$1,false)",[storekeeperUid]);
 const remainder=(await db.query("SELECT dispense_stock_bon_signed_v2('request-partial',$1,'[]','Magasinier Test',NULL) result",[[{index:0,quantity:1}]])).rows[0].result;
 assert.equal(remainder.status,'LIVREE');
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-1'")).rows[0].qty,'0','post-manager storekeeper signature does not debit a second time');

 const b01Bon={...readyBon,id:'BON-B01-PARTIAL-HANDOVER',assignedGestionnaireUid:bureau01ManagerUid,items:[{op:'ITC-B01',label:'B01 CABLE',qty:2}]};
 await db.exec('RESET ROLE');
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes','request-b01','COMPANY-A',$1)",[b01Bon]);
 await db.exec('SET ROLE authenticated');
 await db.query("SELECT set_config('test.uid',$1,false)",[storekeeperUid]);
 const b01Handover=(await db.query("SELECT dispense_stock_bon_signed_v2('request-b01',$1,'[]','Magasinier Test',NULL) result",[[{index:0,quantity:1}]])).rows[0].result;
 assert.equal(b01Handover.status,'EN ATTENTE GESTIONNAIRE');
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-b01'")).rows[0].qty,'5','B01 handover leaves stock unchanged before manager signature');
 await db.query("SELECT set_config('test.uid',$1,false)",[bureau01ManagerUid]);
 const b01Signed=(await db.query("SELECT issue_stock_request_signed('request-b01','Gestionnaire B01',NULL,'PROD',NULL) result")).rows[0].result;
 assert.equal(b01Signed.status,'PARTIELLEMENT SERVI','B01 manager signature preserves the recorded partial handover');
 assert.equal(b01Signed.managerDebitAt!==undefined,true,'B01 manager debit is visible to the storekeeper flow');
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-b01'")).rows[0].qty,'3','B01 manager signature performs the debit');
 await db.query("SELECT set_config('test.uid',$1,false)",[storekeeperUid]);
 const b01Remainder=(await db.query("SELECT dispense_stock_bon_signed_v2('request-b01',$1,'[]','Magasinier Test',NULL) result",[[{index:0,quantity:1}]])).rows[0].result;
 assert.equal(b01Remainder.status,'LIVREE');
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' AND record_key='stock-b01'")).rows[0].qty,'3','B01 remainder signature does not debit a second time');

 const scanner=fs.readFileSync('assets/bon-scanner.js','utf8');
 const managerView=fs.readFileSync('index.html','utf8');
 const managerWorkflow=fs.readFileSync('assets/validator-workflow.js','utf8');
 assert.match(scanner,/Cette signature du magasinier ne débite jamais le stock/);
 assert.match(managerView,/Remise déjà effectuée par le magasinier/);
 assert.match(managerView,/Deja remis/);
 assert.match(managerWorkflow,/le débit du stock \?/);
 await db.close();
 console.log('PASS: storekeeper handover records served quantities and signature without stock changes; the manager sees the handover and owns the debit, with no second debit after manager signature.');
})().catch(error=>{console.error(error);process.exitCode=1;});
