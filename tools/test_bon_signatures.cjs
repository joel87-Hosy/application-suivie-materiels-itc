const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=';
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 const migration=n=>fs.readFileSync('supabase/migrations/'+n,'utf8');
 await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON app_records,app_settings TO authenticated;GRANT SELECT ON app_profiles TO authenticated;');
 for(const file of ['202609180005_validator_workflow.sql','202609190001_validator_bureaus.sql','202609190004_unconditional_workflow.sql','202609240001_repair_rejected_bon_actions.sql','202609240004_bureau02_substocks.sql','202609240005_explicit_substock_issues.sql','202609250002_bon_validity_scanner.sql','202609260001_bon_drawn_signatures.sql','202609260001_bon_drawn_signatures.sql'])await db.exec(migration(file));
 for(const [id,role,company] of [[1,'Technicien','A'],[2,'Coordinateur','A'],[3,'Validateur','A'],[4,'Gestionnaire','A'],[5,'Gestionnaire','B'],[6,'Coordinateur','A'],[7,'Technicien','A']]){
  await db.query('INSERT INTO auth.users VALUES($1)',[uuid(id)]);
  await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,profile) VALUES($1,$2,$3,$4,$5)',[uuid(id),company,role,{OCI:true},{id,name:'Person '+id}]);
 }
 const as=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[uuid(id)]);await db.exec('SET ROLE authenticated');};
 const read=async key=>(await db.query("SELECT payload FROM app_records WHERE collection='demandes' AND record_key=$1",[key])).rows[0].payload;
 const create=async key=>{await as(1);await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes',$1,'A',$2)",[key,{id:key,company_id:'A',technicienUid:uuid(1),coordinateurId:2,status:'EN ATTENTE COORDINATION',items:[{op:'OCI',label:'CABLE',qty:5}],serviceAbbreviation:'B2B',bonSignatures:{technician:{name:'Technicien',image:png,uid:'forged',at:'2099-01-01'}}}]);};
 const coordinate=async key=>{await as(2);await db.query("UPDATE app_records SET payload=payload||jsonb_build_object('status','EN ATTENTE GESTIONNAIRE','bonSignatures',(payload->'bonSignatures')||$2::jsonb) WHERE collection='demandes' AND record_key=$1",[key,JSON.stringify({coordination:{name:'Coordinateur',image:png}})]);};
 const decide=(key,approve=true,image=png)=>db.query('SELECT decide_stock_request_signed($1,$2,$3,$4,$5,$6)',[key,approve,uuid(4),approve?'Accord':'À corriger','Validateur',image]);
 const issue=(key,name='Gestionnaire',image=png)=>db.query('SELECT issue_stock_request_signed($1,$2,$3,$4,NULL)',[key,name,image,'B2B']);
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock','stock1','A',$1)",[{op:'OCI',company_id:'A',label:'CABLE',qty:100}]);
 await create('r1');let request=await read('r1');assert.equal(request.bonSignatures.technician.uid,uuid(1));assert.notEqual(request.bonSignatures.technician.at,'2099-01-01');
 await assert.rejects(db.exec("UPDATE app_records SET payload=jsonb_set(payload,'{bonSignatures,validator}','{\"name\":\"Forged\"}') WHERE record_key='r1'"),/validation/);
 await as(7);await assert.rejects(db.query("UPDATE app_records SET payload=payload||jsonb_build_object('technicienUid',$1::text,'bonSignatures',$2::jsonb) WHERE record_key='r1'",[uuid(7),JSON.stringify({technician:{name:'Forged',image:png}})]),/technicien/);
 await as(6);await assert.rejects(db.query("UPDATE app_records SET payload=payload||jsonb_build_object('coordinateurId',6,'bonSignatures',(payload->'bonSignatures')||$1::jsonb) WHERE record_key='r1'",[JSON.stringify({coordination:{name:'Wrong coordinator',image:png}})]),/coordination/);
 await coordinate('r1');request=await read('r1');assert.equal(request.bonSignatures.coordination.uid,uuid(2));assert.equal(request.status,'EN ATTENTE VALIDATEUR');
 await as(3);await assert.rejects(decide('r1',true,'data:image/svg+xml;base64,PHN2Zz4='),/PNG/);assert.equal((await read('r1')).status,'EN ATTENTE VALIDATEUR');
 await decide('r1');request=await read('r1');assert.equal(request.bonSignatures.validator.image,png);assert.equal(request.bonSignatures.validator.uid,uuid(3));
 await as(5);await assert.rejects(issue('r1'),/affectation/);
 await as(4);await issue('r1');request=await read('r1');assert.equal(request.status,'LIVREE');assert.equal(Object.keys(request.bonSignatures).length,4);
 const delivered=(await db.query("SELECT payload FROM app_records WHERE collection='sorties' AND record_key=$1",[request.sortieId])).rows[0].payload;
 assert.deepEqual(delivered.bonSignatures,request.bonSignatures);
 await issue('r1','Other name',null);assert.equal((await read('r1')).bonSignatures.manager.name,'Gestionnaire','retry cannot replace the original signature');
 assert.equal((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE record_key='stock1'")).rows[0].qty,'95');
 // Correction archives all drawings and removes them from the current version.
 await create('r2');await coordinate('r2');await as(3);await decide('r2',false);request=await read('r2');await as(4);
 await db.query('SELECT resubmit_stock_request($1,$2,$3)',['r2',request.validatorDecision,{note:'Correction',motif:'Installation',demandeurName:'Technicien',serviceAbbreviation:'B2B',items:[{stockKey:'stock1',qty:3}]}]);
 request=await read('r2');assert.equal(request.bonSignatures,undefined);assert.equal(request.correctionHistory[0].before.bonSignatures.technician.image,png);
 // Expiration rejects the signed issue atomically; renewal preserves the old signature.
 await create('r3');await coordinate('r3');await as(3);await decide('r3',true,null);
 await db.exec('RESET ROLE');await db.exec("UPDATE app_records SET payload=payload||jsonb_build_object('bonValidUntil',clock_timestamp()-interval '1 second') WHERE record_key='r3'");
 await as(4);await assert.rejects(issue('r3'),/expiré/);request=await read('r3');assert.equal(request.bonSignatures.manager,undefined);
 await db.exec("SELECT request_bon_renewal('r3')");await as(3);
 await db.query("SELECT confirm_bon_renewal_signed('r3',$1,true,'Technicien présent','Validateur', $2)",[JSON.stringify(request.bonValidUntil),png]);
 request=await read('r3');assert.equal(request.bonSignatures.validator.image,png);assert.equal(request.bonRenewals[0].previousSignature.image,null);assert.equal(request.bonRenewals[0].signature.image,png);
 await db.close();console.log('PASS: four persisted signatures, authenticated signers, PNG validation, scoped decisions, signed delivery/retry, expiration rollback, renewal and correction history.');
})().catch(error=>{console.error(error);process.exitCode=1});
