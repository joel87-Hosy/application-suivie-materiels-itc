const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const migration=file=>fs.readFileSync('supabase/migrations/'+file,'utf8');
const B01={'ITC-B01':true,CIC:true,MTN:true,OCI:true},B02={'ITC-B02':true,MOOV:true};
const keysOf=scopes=>Object.fromEntries(Object.keys(scopes).map(op=>['COMP-ITC-LEGACY|'+op,true]));
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA migration_private; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON app_records,app_settings TO authenticated; GRANT SELECT ON app_profiles TO authenticated;');
 await db.exec(migration('202609180003_cable_offcuts.sql').split('DO $$')[0]);
 await db.exec(migration('202609180005_validator_workflow.sql'));
 await db.exec(migration('202609190001_validator_bureaus.sql'));
 const accounts=[[1,'gest@itc.ci','Gestionnaire',B01],[2,'gest_b02@itc.ci','Gestionnaire',B02],
  [3,'wandjadeslande@ivoiretechnocom.ci','Validateur',{}],[4,'nguessanpierre@ivoiretechnocom.ci','Validateur',{}],[5,'diakiteaboubakar@ivoiretechnocom.ci','Validateur',{}]];
 for(const [id,email,role,scopes] of accounts){
  await db.query('INSERT INTO auth.users VALUES($1,$2)',[uuid(id),email]);
  const profile={id,uid:uuid(id),email,name:email,role,company_id:'COMP-ITC-LEGACY'};
  await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,control_scope_keys,profile) VALUES($1,$2,$3,$4,$5,$6)',[uuid(id),'COMP-ITC-LEGACY',role,JSON.stringify(scopes),JSON.stringify(keysOf(scopes)),JSON.stringify(profile)]);
  await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('users',$1,'COMP-ITC-LEGACY',$2)",[uuid(id),JSON.stringify(profile)]);
 }
 await db.exec("INSERT INTO stock_workflow_config VALUES('COMP-ITC-LEGACY',true)");
 // Bons déjà en attente au moment de l'affectation : les validateurs n'ont encore aucun périmètre.
 for(const [key,op] of [['pending-b01','ITC-B01'],['pending-b02','MOOV'],['pending-mixed',null]])
  await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes',$1,'COMP-ITC-LEGACY',$2)",
   [key,JSON.stringify({id:key.toUpperCase(),ref:key,op:op||'ITC-B01',status:'EN ATTENTE VALIDATEUR',statut:'EN ATTENTE VALIDATEUR',
    items:op?[{label:'Cable',qty:5}]:[{op:'ITC-B01',label:'Cable',qty:1},{op:'MOOV',label:'Cable',qty:1}]})]);
 assert.equal((await db.query("SELECT count(*)::int n FROM app_records WHERE collection='notifications'")).rows[0].n,0,'aucun validateur notifié sans périmètre');

 await db.exec(migration('202609190002_assign_validator_bureaus.sql'));
 const validators=async()=>(await db.query("SELECT u.email,p.control_scopes scopes,p.control_scope_keys keys,p.profile->>'validationBureau' bureau,r.payload record FROM app_profiles p JOIN auth.users u ON u.id=p.user_id JOIN app_records r ON r.collection='users' AND r.payload->>'uid'=p.user_id::text WHERE p.role='Validateur' ORDER BY u.email")).rows;
 const assigned=await validators();
 assert.deepEqual(assigned.map(v=>[v.email,v.bureau]),[
  ['diakiteaboubakar@ivoiretechnocom.ci','B02'],['nguessanpierre@ivoiretechnocom.ci','B02'],['wandjadeslande@ivoiretechnocom.ci','B01']]);
 for(const v of assigned){
  const expected=v.bureau==='B01'?B01:B02;
  assert.deepEqual(v.scopes,expected,v.email+' : stocks dédiés');
  assert.deepEqual(v.keys,keysOf(expected),v.email+' : clés de périmètre');
  assert.deepEqual(v.record.controlScopes,expected,v.email+' : fiche utilisateur synchronisée');
  assert.equal(v.record.validationBureau,v.bureau);
 }
 const inbox=async()=>(await db.query("SELECT u.email,r.payload->>'message' message FROM app_records r JOIN app_profiles p ON p.profile->'id'=r.payload->'userId' JOIN auth.users u ON u.id=p.user_id WHERE r.collection='notifications' ORDER BY u.email,message")).rows;
 assert.deepEqual((await inbox()).map(n=>[n.email,n.message]),[
  ['diakiteaboubakar@ivoiretechnocom.ci','BON À VALIDER — B02 : pending-b02'],
  ['nguessanpierre@ivoiretechnocom.ci','BON À VALIDER — B02 : pending-b02'],
  ['wandjadeslande@ivoiretechnocom.ci','BON À VALIDER — B01 : pending-b01']],'chaque bureau ne reçoit que ses bons, le bon mixte reste hors périmètre');

 await db.exec(migration('202609190002_assign_validator_bureaus.sql'));
 assert.deepEqual(await validators(),assigned,'réexécution sans effet');
 assert.equal((await inbox()).length,3,'aucune notification dupliquée');

 await db.exec("UPDATE app_profiles SET is_active=false WHERE user_id='"+uuid(3)+"'");
 await assert.rejects(db.exec(migration('202609190002_assign_validator_bureaus.sql')),/Compte ou périmètre inattendu/,'compte absent ou suspendu : migration annulée');
 await db.exec('ROLLBACK');
 assert.deepEqual((await validators()).filter(v=>v.email.startsWith('nguessan')),assigned.filter(v=>v.email.startsWith('nguessan')),'échec sans écriture partielle');
 await db.close();
 console.log('PASS: affectation B01/B02, périmètres hérités du gestionnaire, fiches et notifications synchronisées, réexécution neutre, compte manquant bloquant.');
})().catch(e=>{console.error(e);process.exitCode=1});
