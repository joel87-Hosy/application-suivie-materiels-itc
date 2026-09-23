const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202609180002_app_backend.sql','utf8').split('DO $$')[0]);
 await db.exec(fs.readFileSync('supabase/migrations/202609230007_material_types.sql','utf8'));
 const uid='00000000-0000-0000-0000-000000000001';
 await db.query('INSERT INTO auth.users VALUES($1)',[uid]);await db.query("INSERT INTO app_profiles(user_id,company_id,role) VALUES($1,'A','Gestionnaire')",[uid]);await db.query("SELECT set_config('test.uid',$1,false)",[uid]);
 const add=name=>db.query('SELECT add_material_type($1) types',[name]);
 await db.exec('SET ROLE authenticated');assert.deepEqual((await add('  Nouveau type  ')).rows[0].types,['NOUVEAU TYPE']);
 assert.deepEqual((await add('nouveau TYPE')).rows[0].types,['NOUVEAU TYPE']);
 assert.deepEqual((await add('Autre')).rows[0].types,['AUTRE','NOUVEAU TYPE']);
 await assert.rejects(add(''),/invalide/);await assert.rejects(add('__ADD_NEW__'),/invalide/);
 await db.exec("RESET ROLE;UPDATE app_profiles SET company_id='B';SET ROLE authenticated");assert.deepEqual((await add('Type B')).rows[0].types,['TYPE B']);
 await db.exec("RESET ROLE;UPDATE app_profiles SET is_active=false;SET ROLE authenticated");await assert.rejects(add('Refus'),/actif/);
 await db.exec('RESET ROLE');assert.deepEqual((await db.query("SELECT value FROM app_settings WHERE company_id='A'")).rows[0].value,['AUTRE','NOUVEAU TYPE']);
 await db.close();console.log('PASS: manager adds durable material types, normalized deduplication, previous types retained, tenant isolation and inactive denial.');
})().catch(e=>{console.error(e);process.exitCode=1});
