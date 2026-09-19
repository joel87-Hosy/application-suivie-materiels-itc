const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const migration=file=>fs.readFileSync('supabase/migrations/'+file,'utf8');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON app_records,app_settings TO authenticated; GRANT SELECT ON app_profiles TO authenticated;');
 await db.exec(migration('202609180003_cable_offcuts.sql').split('DO $$')[0]);
 await db.exec(migration('202609180005_validator_workflow.sql'));
 await db.exec(migration('202609190001_validator_bureaus.sql'));
 await db.exec(migration('202609190003_bon_service.sql'));
 for(const [id,role,company,scopes] of [[1,'Gestionnaire','A',{'ITC-B01':true}],[2,'Gestionnaire','A',{'ITC-B02':true,MOOV:true}],[3,'Superviseur','A',{}],[4,'Technicien','A',{}],[5,'Validateur','A',{'ITC-B01':true}],[6,'Gestionnaire','B',{'ITC-B01':true}]]){
  await db.query('INSERT INTO auth.users VALUES($1)',[uuid(id)]);
  await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,profile) VALUES($1,$2,$3,$4,$5)',[uuid(id),company,role,JSON.stringify(scopes),JSON.stringify({id,name:role+' '+id})]);
 }
 await db.exec("INSERT INTO stock_workflow_config VALUES('A',true),('B',true)");
 const as=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[uuid(id)]);await db.exec('SET ROLE authenticated');};
 const seed=async()=>{
  await db.exec('RESET ROLE');
  await db.exec("DELETE FROM app_records WHERE collection IN ('demandes','sorties')");
  const items=JSON.stringify([{op:'ITC-B01',label:'Cable',qty:2}]);
  await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes','d1','A',$1)",[JSON.stringify({id:'BS-1',op:'ITC-B01',status:'LIVREE',sortieId:'S-1',items:JSON.parse(items)})]);
  await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('sorties','s1','A',$1)",[JSON.stringify({id:'S-1',op:'ITC-B01',sourceDemandeId:'BS-1',managerSignatureText:'Signature originale',items:JSON.parse(items)})]);
 };
 const services=async()=>{await db.exec('RESET ROLE');return (await db.query("SELECT collection,record_key,payload->>'serviceAbbreviation' service,payload->>'managerSignatureText' signature FROM app_records WHERE collection IN ('demandes','sorties') ORDER BY collection,record_key")).rows;};

 await seed();
 await as(1);
 const touched=(await db.query("SELECT assign_bon_service('sorties','s1','DEP') r")).rows[0].r;
 assert.deepEqual(touched,[{collection:'demandes',record_key:'d1'},{collection:'sorties',record_key:'s1'}],'le bon lié suit');
 assert.deepEqual((await services()).map(r=>[r.collection,r.service]),[['demandes','DEP'],['sorties','DEP']]);
 assert.equal((await services())[1].signature,'Signature originale','les autres champs du bon sont préservés');

 await as(1);await db.exec("SELECT assign_bon_service('demandes','d1','MAIN')");
 assert.deepEqual((await services()).map(r=>r.service),['MAIN','MAIN'],'réaffectation depuis la demande');

 for(const [actorId,pattern,label] of [[4,/gestionnaire ou au superviseur/,'technicien'],[5,/gestionnaire ou au superviseur/,'validateur']]){
  await as(actorId);
  await assert.rejects(db.exec("SELECT assign_bon_service('sorties','s1','B2B')"),pattern,label+' refusé');
 }
 await as(2);await assert.rejects(db.exec("SELECT assign_bon_service('sorties','s1','B2B')"),/stocks que vous ne gérez pas/,'gestionnaire hors périmètre');
 await as(6);await assert.rejects(db.exec("SELECT assign_bon_service('sorties','s1','B2B')"),/introuvable/,'autre entreprise');
 await as(1);
 await assert.rejects(db.exec("SELECT assign_bon_service('sorties','s1','AUTRE')"),/service autorisé/);
 await assert.rejects(db.exec("SELECT assign_bon_service('stock','s1','DEP')"),/Type de bon invalide/);
 await assert.rejects(db.exec("SELECT assign_bon_service('sorties','inconnu','DEP')"),/introuvable/);
 assert.deepEqual((await services()).map(r=>r.service),['MAIN','MAIN'],'aucun refus n’a écrit');

 await as(3);await db.exec("SELECT assign_bon_service('sorties','s1','B2B')");
 assert.deepEqual((await services()).map(r=>r.service),['B2B','B2B'],'le superviseur couvre toute l’entreprise');

 // Un bon isolé ne doit toucher que lui-même.
 await db.exec('RESET ROLE');
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('sorties','seul','A',$1)",[JSON.stringify({id:'S-2',op:'ITC-B01',items:[{op:'ITC-B01',label:'Cable',qty:1}]})]);
 await as(1);
 assert.deepEqual((await db.query("SELECT assign_bon_service('sorties','seul','DEP') r")).rows[0].r,[{collection:'sorties',record_key:'seul'}],'pas de propagation parasite');
 assert.deepEqual((await services()).map(r=>r.service),['B2B','B2B','DEP'],'les bons liés ne sont pas touchés');

 // Le contrôle serveur couvre aussi le bon lié, même si le client est contourné.
 await db.exec('RESET ROLE');
 await db.exec(`UPDATE app_records SET payload=jsonb_set(payload,'{items}','[{"op":"MOOV","qty":2}]') WHERE record_key='s1'`);
 await as(1);
 await assert.rejects(db.exec("SELECT assign_bon_service('demandes','d1','DEP')"),/stocks que vous ne gérez pas/);
 assert.deepEqual((await services()).map(r=>r.service),['B2B','B2B','DEP'],'refus atomique si le bon lié est hors périmètre');
 await db.exec('RESET ROLE');
 await db.query('UPDATE app_profiles SET is_active=false WHERE user_id=$1',[uuid(1)]);
 await as(1);
 await assert.rejects(db.exec("SELECT assign_bon_service('sorties','seul','MAIN')"),/Connexion requise/);
 await db.close();
 console.log('PASS: service émetteur côté serveur, propagation demande/sortie, périmètre gestionnaire, superviseur, rôles refusés et bons isolés.');
})().catch(e=>{console.error(e);process.exitCode=1});
