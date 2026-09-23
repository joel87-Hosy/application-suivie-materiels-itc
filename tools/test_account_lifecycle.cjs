const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(fs.readFileSync('supabase/migrations/202609180002_app_backend.sql','utf8').split('DO $$')[0]);
 const migration=fs.readFileSync('supabase/migrations/202609230003_company_account_lifecycle.sql','utf8');await db.exec(migration);await db.exec(migration);
 for(const [id,role,company] of [[1,'Superviseur','A'],[2,'Technicien','A'],[3,'DG','A'],[4,'Technicien','B'],[5,'SUPER_ADMIN','A']]){
  await db.query('INSERT INTO auth.users VALUES($1,$2)',[uuid(id),id+'@test']);
  const profile={id,uid:'firebase-'+id,name:'User '+id,role,company_id:company,is_active:true};
  await db.query('INSERT INTO app_profiles(user_id,firebase_uid,company_id,role,profile) VALUES($1,$2,$3,$4,$5)',[uuid(id),profile.uid,company,role,JSON.stringify(profile)]);
  await db.query("INSERT INTO app_records VALUES('users',$1,$2,$3,now())",[profile.uid,company,JSON.stringify(profile)]);
 }
 const prepare=(actor,target,action,id)=>db.query('SELECT prepare_company_account_action($1,$2,$3,$4) op',[uuid(actor),'firebase-'+target,action,uuid(id)]);
 const finish=(actor,id)=>db.query('SELECT finish_company_account_action($1,$2) op',[uuid(actor),uuid(id)]);
 await assert.rejects(prepare(2,1,'delete',10),/directeur/);await assert.rejects(prepare(1,4,'delete',10),/entreprise/);
 await assert.rejects(prepare(1,1,'suspend',10),/protégé/);await assert.rejects(prepare(3,5,'delete',10),/protégé/);
 const first=(await prepare(3,2,'suspend',10)).rows[0].op;
 assert.equal(first.target_id,uuid(2));
 assert.equal((await prepare(3,2,'suspend',11)).rows[0].op.id,uuid(10),'interrupted action resumes with its existing operation');
 await assert.rejects(prepare(3,2,'activate',12),/en cours/);
 await db.query("SELECT set_config('test.uid',$1,false)",[uuid(2)]);
 assert.equal((await db.query('SELECT (current_app_profile()).user_id id')).rows[0].id,null,'existing sessions lose application rights immediately');
 await finish(3,10);await finish(3,10);
 assert.equal((await db.query('SELECT is_active FROM app_profiles WHERE user_id=$1',[uuid(2)])).rows[0].is_active,false);
 await prepare(1,2,'activate',12);await finish(1,12);
 assert.equal((await db.query('SELECT is_active FROM app_profiles WHERE user_id=$1',[uuid(2)])).rows[0].is_active,true);
 await prepare(1,2,'disable',13);await finish(1,13);
 assert.equal((await db.query("SELECT payload->>'account_status' status FROM app_records WHERE collection='users' AND record_key='firebase-2'")).rows[0].status,'disabled');
 await prepare(1,2,'delete',14);await assert.rejects(finish(1,14),/Auth/);
 await db.query('DELETE FROM auth.users WHERE id=$1',[uuid(2)]);
 assert.equal((await prepare(1,2,'delete',15)).rows[0].op.id,uuid(14),'retry after Auth deletion and profile cascade');
 await finish(1,14);
 assert.equal((await db.query("SELECT count(*)::int n FROM app_records WHERE collection='users' AND record_key='firebase-2'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM app_records WHERE collection='platformAuditLogs'")).rows[0].n,4);
 await db.exec('SET ROLE authenticated');await assert.rejects(prepare(1,4,'delete',16),/permission/);
 await db.close();console.log('PASS: DG/supervisor lifecycle, tenant/self/admin protection, immediate session blocking, retries across Auth deletion, reactivation, statuses and retained audit.');
})().catch(error=>{console.error(error);process.exitCode=1});
