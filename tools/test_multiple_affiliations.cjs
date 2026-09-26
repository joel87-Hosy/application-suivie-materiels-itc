const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'),company='COMP-ITC-LEGACY';
const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON app_records,app_settings TO authenticated;GRANT SELECT ON app_profiles TO authenticated;');
 for(const name of ['202609180005_validator_workflow.sql','202609190001_validator_bureaus.sql','202609190004_unconditional_workflow.sql','202609190005_city_stocks.sql','202609240001_repair_rejected_bon_actions.sql','202609240004_bureau02_substocks.sql','202609240005_explicit_substock_issues.sql','202609250002_bon_validity_scanner.sql','202609260001_bon_drawn_signatures.sql','202609260002_account_affiliations.sql','202609260003_special_validation_routing.sql','202609260004_multiple_affiliations_choices.sql','202609260004_multiple_affiliations_choices.sql'])await db.exec(migration(name));
 const fixture=async(id,role,office,tenant=company)=>{
  const profile={id,uid:uuid(id),role,name:'User '+id,company_id:tenant,office,serviceAbbreviation:'B2B'};
  await db.query('INSERT INTO auth.users VALUES($1,$2)',[uuid(id),id===3?'moovmaintenance@ivoiretechnocom.ci':id+'@test']);
  await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,profile) VALUES($1,$2,$3,$4,$5)',[uuid(id),tenant,role,{['ITC-'+office]:true},profile]);
  await db.query("INSERT INTO app_records VALUES('users',$1,$2,$3,now())",[uuid(id),tenant,profile]);
 };
 for(const [id,role,office] of [[1,'Superviseur','B01'],[2,'Technicien','B01'],[3,'Coordinateur','B01'],[4,'Coordinatrice','B01'],[5,'Validateur','B01'],[6,'Validatrice','B02'],[7,'Gestionnaire','B02'],[8,'Gestionnaire','B01'],[10,'Validateur','B02']])await fixture(id,role,office);
 await fixture(9,'Validateur','B01','OTHER');
 const as=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[uuid(id)]);await db.exec('SET ROLE authenticated');};
 const read=async key=>(await db.query("SELECT payload FROM app_records WHERE collection='demandes' AND record_key=$1",[key])).rows[0]?.payload;
 const insert=(key,extra={})=>db.query("INSERT INTO app_records VALUES('demandes',$1,$2,$3,now())",[key,company,{id:key,company_id:company,coordinateurId:3,originOffice:'B01',serviceAbbreviation:'B2B',status:'EN ATTENTE VALIDATEUR',items:[{op:'ITC-B02',label:'CABLE',qty:1}],...extra}]);
 const choices=(validator=5,office='B01',manager=7)=>({requestedValidatorUid:uuid(validator),requestedValidationOffice:office,requestedManagerUid:uuid(manager)});
 await as(3);const options=(await db.query('SELECT workflow_request_choices() result')).rows[0].result;assert.equal(options.enabled,true);assert.equal(options.validators.length,3);assert.ok(!options.validators.some(v=>v.id===9));
 await assert.rejects(insert('missing'),/validateur/);await assert.rejects(insert('wrong-office',choices(5,'B02')),/validateur/);await assert.rejects(insert('foreign',choices(9)),/validateur/);await assert.rejects(insert('wrong-manager',choices(5,'B01',8)),/stocks/);
 await insert('b01',choices());assert.equal((await read('b01')).validationOffice,'B01');assert.equal((await read('b01')).selectedValidatorId,'5');
 const notice=(await db.query("SELECT payload->>'userId' id FROM app_records WHERE collection='notifications' AND payload->>'message' LIKE '%: b01'")).rows;assert.deepEqual(notice.map(r=>r.id),['5']);
 await assert.rejects(db.query("UPDATE app_records SET payload=payload||$1 WHERE record_key='b01'",[choices(6,'B02')]),/réservé/);
 await as(6);await assert.rejects(db.query("SELECT decide_stock_request('b01',true,$1,'')",[uuid(7)]),/bureau/);
 await as(5);await assert.rejects(db.query("SELECT decide_stock_request('b01',true,$1,'')",[uuid(8)]),/conservé/);await db.query("SELECT decide_stock_request_signed('b01',true,$1,'','Validator B01',NULL)",[uuid(7)]);
 await db.exec('RESET ROLE');await db.exec("UPDATE app_records SET payload=payload||jsonb_build_object('bonValidUntil',clock_timestamp()-interval '1 second') WHERE record_key='b01'");
 await as(7);await db.exec("SELECT request_bon_renewal('b01')");await as(5);await db.query("SELECT confirm_bon_renewal('b01',$1,true,'Present')",[JSON.stringify((await read('b01')).bonValidUntil)]);
 await as(3);await insert('b02',choices(6,'B02'));await as(10);await assert.rejects(db.query("SELECT decide_stock_request('b02',true,$1,'')",[uuid(7)]),/bureau/);await as(6);await db.query("SELECT decide_stock_request('b02',true,$1,'')",[uuid(7)]);
 await as(4);assert.equal((await db.query('SELECT workflow_request_choices() result')).rows[0].result.enabled,false);await assert.rejects(insert('forged',{coordinateurId:4,...choices()}),/réservé/);
 // Signing a technician's request uses the same upsert path as the application.
 await as(2);await insert('tech',{status:'EN ATTENTE COORDINATION',technicienUid:uuid(2),technicienId:2});
 await as(3);const previous=await read('tech');const payload={...previous,...choices(6,'B02'),status:'EN ATTENTE GESTIONNAIRE'};
 await db.query('SELECT save_app_changes($1)',[[{collection:'demandes',record_key:'tech',company_id:company,previous,payload}]]);
 await assert.rejects(db.query('SELECT save_app_changes($1)',[[{collection:'demandes',record_key:'tech',company_id:company,previous,payload}]]),/modifiées/);
 assert.equal((await read('tech')).status,'EN ATTENTE VALIDATEUR');assert.equal((await read('tech')).selectedValidatorId,'6');
 // Multiple affiliations and named correspondents are authoritative.
 await as(1);
 const assign=(id,offices,services,coords=[],validators=[])=>db.query('SELECT assign_account_affiliations($1,$2,$3,$4,$5)',[uuid(id),offices,services,coords,validators]);
 await assign(4,['B01','B02'],['B2B','MAIN']);await assign(5,['B01','B02'],['B2B']);await assign(2,['B01','B02'],['B2B','MAIN'],['4'],['5']);
 await assert.rejects(assign(2,['B01'],['B2B'],[],['9']),/Validateur/);await assert.rejects(assign(2,[],['B2B']),/obligatoires/);
 await as(2);await assert.rejects(assign(2,['B01'],['B2B']),/responsable/);await assert.rejects(db.exec(`UPDATE app_records SET payload=payload||'{"offices":["B01"]}' WHERE collection='users' AND payload->>'id'='2'`),/rattachement/);
 await assert.rejects(insert('forbidden-coord',{status:'EN ATTENTE COORDINATION',coordinateurId:3}),/coordinateur/);
 await insert('multi',{status:'EN ATTENTE COORDINATION',coordinateurId:4,originOffice:'B02',serviceAbbreviation:'MAIN'});const multi=await read('multi');assert.equal(multi.originOffice,'B02');assert.equal(multi.serviceAbbreviation,'MAIN');assert.deepEqual(multi.eligibleValidatorIds,['5']);
 await as(4);await db.exec("UPDATE app_records SET payload=payload||'{\"status\":\"EN ATTENTE VALIDATEUR\"}' WHERE record_key='multi'");
 await as(6);await assert.rejects(db.query("SELECT decide_stock_request('multi',true,$1,'')",[uuid(7)]),/bureau/);await as(5);await db.query("SELECT decide_stock_request('multi',true,$1,'')",[uuid(7)]);
 await as(1);await assign(2,['B01'],['B2B'],['3','4'],['5']);
 await as(2);await insert('tech-special',{status:'EN ATTENTE COORDINATION',technicienUid:uuid(2),technicienId:2});
 await as(3);await db.query("UPDATE app_records SET payload=payload||$1 WHERE record_key='tech-special'",[{...choices(5,'B01'),status:'EN ATTENTE VALIDATEUR'}]);assert.equal((await read('tech-special')).selectedValidatorId,'5','special coordinator may choose B01 despite initial default B02');
 // Transactional account creation: invalid links cannot leave an incomplete profile.
 await db.exec('RESET ROLE');await db.query('INSERT INTO auth.users VALUES($1,$2)',[uuid(20),'20@test']);
 const register=ids=>db.query("SELECT register_company_user_multi($1,$2,$3,'Technicien','New','20@test',ARRAY[]::text[],ARRAY['B01','B02'],ARRAY['B2B','MAIN'],ARRAY['4'],$4)",[uuid(1),uuid(20),company,ids]);
 await assert.rejects(register(['9']),/Validateur/);assert.equal((await db.query('SELECT count(*)::int n FROM app_profiles WHERE user_id=$1',[uuid(20)])).rows[0].n,0);await register(['5']);
 const created=(await db.query('SELECT profile FROM app_profiles WHERE user_id=$1',[uuid(20)])).rows[0].profile;assert.deepEqual(created.offices,['B01','B02']);assert.deepEqual(created.services,['B2B','MAIN']);assert.deepEqual(created.allowedCoordinatorIds,['4']);
 await db.close();console.log('PASS: chosen B01/B02 validators, single recipient, fixed eligible manager, renewal, upsert signing, multiple offices/services, named correspondents, tenant isolation and account rollback.');
})().catch(error=>{console.error(error);process.exitCode=1});
