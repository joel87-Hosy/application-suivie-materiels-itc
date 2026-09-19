const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
function setup() {
 const calls=[],context={window:{},setInterval,clearInterval};
 vm.createContext(context);vm.runInContext(fs.readFileSync('assets/supabase-store.js','utf8'),context);
 const client={rpc:async(name,args)=>{calls.push({name,args});return {error:null}},from(){throw Error('Navigation must not save settings or reload all data')}};
 const store=new context.window.SupabaseStore(client,()=>{throw Error('Navigation must not redraw a form')},()=>{});
 store.ready=true;store.uid='user';store.profile={id:7,company_id:'A',role:'Coordinateur'};
 store.raw={stock:{s:{label:'ONT',op:'ITC-B01',qty:100,company_id:'A'}},notifications:{
   mine:{userId:'7',company_id:'A',lu:false,message:'Bon'},other:{userId:8,company_id:'A',lu:false},
   read:{userId:7,company_id:'A',lu:true},foreign:{userId:7,company_id:'B',lu:false}
 },settings:{materialTypes:[],scansDuJour:[],derniereDateScan:null,lastConsumptionArchiveKey:null}};
 return {store,client,calls,context};
}
(async()=>{
 const test=setup(),before=JSON.stringify(test.store.raw.stock);
 assert.deepEqual(Array.from(await test.store.markNotificationsRead()),['mine']);
 assert.equal(test.calls.length,1);assert.equal(test.calls[0].args.changes.length,1);
 assert.equal(test.calls[0].args.changes[0].collection,'notifications');
 assert.equal(JSON.stringify(test.store.raw.stock),before);assert.equal(test.store.raw.notifications.other.lu,false);assert.equal(test.store.raw.notifications.foreign.lu,false);
 await test.store.markNotificationsRead();assert.equal(test.calls.length,1,'no write when already read');
 const failed=setup();failed.client.rpc=async()=>({error:Error('Offline')});
 await assert.rejects(failed.store.markNotificationsRead(),/Offline/);assert.equal(failed.store.raw.notifications.mine.lu,false);
 const session=setup();session.client.rpc=async()=>{session.store.stop();return {error:null}};
 assert.deepEqual(Array.from(await session.store.markNotificationsRead()),[]);assert.equal(Object.keys(session.store.raw).length,0,'no old-session data restored');
 const late=setup();await assert.rejects(late.store.save(late.store.value()),/module des stocks est incomplet/);assert.equal(late.calls.length,0);
 // Reproduces the original load order: SupabaseStore loaded before ControlCore.
 late.context.window.ControlCore=require('../assets/control-core');late.store.read=async()=>{};
 const data=late.store.value();data.stock[0].qty=101;await late.store.save(data);
 assert.equal(late.calls.length,1);assert.equal(late.calls[0].args.changes[0].payload.scope_key,'A|ITC-B01');
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('src="assets/control-core.js')<html.indexOf('src="assets/supabase-store.js'));
 assert.equal([...html.matchAll(/async function markNotificationsAsRead\(/g)].length,1);
 console.log('PASS: dependency order, late module resolution, notification-only writes, user/tenant isolation, no-op, failure preservation and session changes.');
})().catch(e=>{console.error(e);process.exitCode=1});
