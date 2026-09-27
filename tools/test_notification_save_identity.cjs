const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
 const context={window:{ControlCore:require('../assets/control-core')},console};
 vm.createContext(context);vm.runInContext(fs.readFileSync('assets/supabase-store.js','utf8'),context);
 const records=new Map();let loseResponse=true;
 const store=new context.window.SupabaseStore({rpc:async(name,{changes})=>{
  assert.equal(name,'save_app_changes');
  for(const row of changes)records.set(row.record_key,row);
  if(loseResponse){loseResponse=false;return {error:Error('Response lost after commit')};}
  return {};
 }},()=>{},()=>{});
 store.ready=true;store.profile={id:7,company_id:'A',role:'Gestionnaire'};
 store.raw={settings:{materialTypes:[],scansDuJour:[],derniereDateScan:null,lastConsumptionArchiveKey:null}};
 const snapshot=store.value();snapshot.notifications.push({userId:7,company_id:'A',lu:false,message:'Commande'});
 store.read=async()=>{store.raw.notifications=Object.fromEntries([...records].map(([key,row])=>[key,row.payload]));};
 await assert.rejects(store.save(snapshot),/Response lost/);
 const key=snapshot.notifications[0]._dbKey;assert.ok(key);
 await store.save(snapshot);assert.equal(records.size,1,'retry uses the same identity after a lost response');
 await store.save(snapshot);assert.equal(records.size,1,'reusing a local snapshot does not duplicate notifications');
 store.readNotificationKeys.add(key);store.raw.notifications[key].lu=true;
 await store.save(snapshot);assert.equal(records.size,1);assert.equal(store.raw.notifications[key].lu,true);
 console.log('PASS: stable notification identity across retries, reused snapshots and read receipts.');
})().catch(error=>{console.error(error);process.exitCode=1;});
