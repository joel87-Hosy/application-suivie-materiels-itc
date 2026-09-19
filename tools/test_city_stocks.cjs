const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON app_records,app_settings TO authenticated;GRANT SELECT ON app_profiles TO authenticated;');
 for(const name of ['202609180005_validator_workflow.sql','202609190001_validator_bureaus.sql','202609190004_unconditional_workflow.sql','202609190005_city_stocks.sql','202609190005_city_stocks.sql'])await db.exec(migration(name));
 const company='COMP-ITC-LEGACY';
 for(const [id,role,tenant] of [[1,'Superviseur',company],[2,'Technicien',company],[3,'Superviseur','OTHER'],[4,'Validateur',company]]){
  await db.query('INSERT INTO auth.users VALUES($1,$2)',[uuid(id),id+'@example.test']);
  await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,profile) VALUES($1,$2,$3,$4,$5)',[uuid(id),tenant,role,JSON.stringify({'ITC-BOUAKE':true,'ITC-SAN-PEDRO':true,'ITC-YAMOUSSOUKRO':true}),JSON.stringify({id,name:role})]);
 }
 await db.query("INSERT INTO app_records VALUES('companies',$1,$1,$2,now())",[company,JSON.stringify({id:company,name:'ITC',status:'active'})]);
 const as=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[uuid(id)]);await db.exec('SET ROLE authenticated');};
 const register=async(id,ops,actor=1,role='Gestionnaire')=>{
  await db.exec('RESET ROLE');await db.query('INSERT INTO auth.users VALUES($1,$2) ON CONFLICT DO NOTHING',[uuid(id),id+'@example.test']);
  return db.query('SELECT register_company_user($1,$2,$3,$4,$5,$6,$7)',[uuid(actor),uuid(id),company,role,'Gestionnaire test',id+'@example.test',ops]);
 };
 assert.equal((await db.query('SELECT count(*)::int n FROM stock_locations')).rows[0].n,9);
 await assert.rejects(register(10,[]),/au moins un stock/);
 await assert.rejects(register(10,['INCONNU']),/Stock inconnu/);
 await assert.rejects(register(10,['ITC-BOUAKE'],2),/réservée/);
 await assert.rejects(register(10,['ITC-BOUAKE'],3),/Entreprise/);
 await register(10,['ITC-BOUAKE']);
 await db.exec("DELETE FROM app_records WHERE collection='companies'");
 await register(11,['ITC-YAMOUSSOUKRO']);
 let profile=(await db.query('SELECT * FROM app_profiles WHERE user_id=$1',[uuid(10)])).rows[0];
 assert.deepEqual(profile.control_scopes,{'ITC-BOUAKE':true});assert.equal(profile.profile.stockScopeMode,'explicit');
 await as(2);await assert.rejects(db.query('SELECT assign_manager_stocks($1,$2)',[uuid(10),['ITC-SAN-PEDRO']]),/réservée/);
 await as(3);await assert.rejects(db.query('SELECT assign_manager_stocks($1,$2)',[uuid(10),['ITC-SAN-PEDRO']]),/entreprise/);
 await as(1);await db.query('SELECT assign_manager_stocks($1,$2)',[uuid(10),['ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO']]);
 await db.exec('RESET ROLE');profile=(await db.query('SELECT * FROM app_profiles WHERE user_id=$1',[uuid(10)])).rows[0];
 assert.deepEqual(profile.control_scopes,{'ITC-SAN-PEDRO':true,'ITC-YAMOUSSOUKRO':true});
 assert.deepEqual((await db.query("SELECT payload->'controlScopes' scopes FROM app_records WHERE collection='users' AND record_key=$1",[uuid(10)])).rows[0].scopes,profile.control_scopes);
 await as(10);
 const put=(key,op)=>db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock',$1,$2,$3)",[key,company,JSON.stringify({company_id:company,op,label:'Cable',qty:100})]);
 await assert.rejects(put('forbidden','ITC-BOUAKE'),/affectation/);
 await put('san','ITC-SAN-PEDRO');await put('yam','ITC-YAMOUSSOUKRO');
 await db.exec('RESET ROLE');await put('bou','ITC-BOUAKE');
 await as(1);await db.query('SELECT assign_manager_stocks($1,$2)',[uuid(10),['ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO']]);
 for(const op of ['ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO']){
  await as(2);await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes',$1,$2,$3)",[op,company,JSON.stringify({id:op,op,items:[{label:'Cable',qty:5}],status:'EN ATTENTE GESTIONNAIRE'})]);
  await as(4);await db.query('SELECT decide_stock_request($1,true,$2,\'\')',[op,uuid(10)]);
  await as(10);await db.query("SELECT issue_validated_request($1,'Signature','DEP')",[op]);
 }
 await db.exec('RESET ROLE');assert.deepEqual((await db.query("SELECT payload->>'qty' qty FROM app_records WHERE collection='stock' ORDER BY record_key")).rows.map(r=>r.qty),['95','95','95']);
 await as(1);await assert.rejects(db.query('SELECT register_company_user($1,$2,$3,$4,$5,$6,$7)',[uuid(1),uuid(10),company,'Gestionnaire','Test','10@example.test',['ITC-BOUAKE']]),/permission/);
 await db.close();console.log('PASS: nine stocks, scoped account provisioning, role and tenant isolation, manager assignment and complete issue workflow in all three cities.');
})().catch(e=>{console.error(e);process.exitCode=1});
