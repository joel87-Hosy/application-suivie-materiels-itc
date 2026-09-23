const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202609180002_app_backend.sql','utf8').split('DO $$')[0]);
 const migration=fs.readFileSync('supabase/migrations/202609230004_notification_read_receipts.sql','utf8');await db.exec(migration);await db.exec(migration);
 const uid='00000000-0000-0000-0000-000000000007';
 await db.query('INSERT INTO auth.users VALUES($1)',[uid]);
 await db.query("INSERT INTO app_profiles(user_id,company_id,role,profile) VALUES($1,'A','Gestionnaire','{\"id\":7}')",[uid]);
 await db.query("SELECT set_config('test.uid',$1,false)",[uid]);
 await db.exec(`INSERT INTO app_records(collection,record_key,company_id,payload) VALUES
 ('notifications','mine','A','{"userId":"7","lu":false}'),
 ('notifications','other','A','{"userId":8,"lu":false}'),
 ('notifications','foreign','B','{"userId":7,"lu":false}'),
 ('notifications','arrival','A','{"userId":7,"lu":false}');SET ROLE authenticated;`);
 const mark=keys=>db.query('SELECT mark_app_notifications_read($1) keys',[keys]);
 assert.deepEqual((await mark(['mine','other','foreign'])).rows[0].keys,['mine']);
 assert.deepEqual((await mark(['mine'])).rows[0].keys,['mine'],'another session reading the same notification is idempotent');
 assert.deepEqual((await mark([])).rows[0].keys,[]);
 await db.exec('RESET ROLE');
 await db.exec(`UPDATE app_records SET payload='{"userId":7,"lu":false,"message":"stale client"}' WHERE record_key='mine';`);
 const rows=(await db.query('SELECT record_key,payload FROM app_records')).rows;
 assert.equal(rows.find(r=>r.record_key==='mine').payload.lu,true);
 for(const key of ['other','foreign','arrival'])assert.equal(rows.find(r=>r.record_key===key).payload.lu,false);
 await db.exec('UPDATE app_profiles SET is_active=false;SET ROLE authenticated');await assert.rejects(mark(['arrival']),/actif/);
 await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(mark(['arrival']),/permission/);
 await db.close();
 // A response to an older read and a stale form cannot undo an acknowledged receipt.
 const context={window:{ControlCore:require('../assets/control-core')},console};vm.createContext(context);vm.runInContext(fs.readFileSync('assets/supabase-store.js','utf8'),context);
 let saves=0;
 const store=new context.window.SupabaseStore({rpc:async(name,args)=>{if(name==='mark_app_notifications_read')return {data:args.record_keys};saves++;return {};},from:()=>({select:()=>({eq:async()=>({data:[]})})})},()=>{},()=>{});
 store.ready=true;store.profile={id:7,company_id:'A'};store.raw={notifications:{mine:{userId:7,company_id:'A',lu:false}},settings:{materialTypes:[],scansDuJour:[],derniereDateScan:null,lastConsumptionArchiveKey:null}};
 const stale=store.value();await store.markNotificationsRead(['mine']);
 store.readAllRecords=async()=>[{collection:'notifications',record_key:'mine',company_id:'A',payload:{userId:7,company_id:'A',lu:false}}];
 await store.read(store.generation);assert.equal(store.value().notifications[0].lu,true);
 store.raw.settings={...stale};for(const key of Object.keys(store.raw.settings))if(!['materialTypes','scansDuJour','derniereDateScan','lastConsumptionArchiveKey'].includes(key))delete store.raw.settings[key];
 store.read=async()=>{};await store.save(stale);assert.equal(saves,0,'stale form does not write lu=false');
 console.log('PASS: atomic receipts, replay, empty selection, tenant/recipient isolation, suspended/anonymous denial, stale client/read protection and unseen arrival.');
})().catch(error=>{console.error(error);process.exitCode=1});
