const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const context={window:{ControlCore:require('../assets/control-core')},setInterval,clearInterval,console};
vm.createContext(context);vm.runInContext(fs.readFileSync('assets/supabase-store.js','utf8'),context);
const rows=Array.from({length:1205},(_,i)=>({collection:'notifications',record_key:String(i).padStart(5,'0'),company_id:'A',payload:{company_id:'A',message:'Notification'}}));
for(let i=0;i<63;i++)rows.push({collection:'stock',record_key:String(i),company_id:'A',payload:{company_id:'A',op:'ITC-B01',label:'Article '+i,qty:i+1}});
rows.push({collection:'stock',record_key:'foreign',company_id:'B',payload:{company_id:'B',qty:999}});
function setup({cap=1000,admin=false,failAt=Infinity}={}) {
 const ranges=[];let changes=0;
 const client={from(name){let company=null,range=[0,999],orders=[];const query={select(){return this},eq(field,value){company=value;return this},order(field){orders.push(field);return this},range(start,end){range=[start,end];return this},then(resolve,reject){
  if(name==='app_settings')return Promise.resolve({data:[],error:null}).then(resolve,reject);
  ranges.push(range);assert.deepEqual(orders,['collection','record_key']);
  if(range[0]>=failAt)return Promise.resolve({data:null,error:Error('Network failure')}).then(resolve,reject);
  const data=rows.filter(r=>!company||r.company_id===company).sort((a,b)=>a.collection.localeCompare(b.collection)||a.record_key.localeCompare(b.record_key)).slice(range[0],Math.min(range[1]+1,range[0]+cap));
  return Promise.resolve({data,error:null}).then(resolve,reject);
 }};return query;}};
 const store=new context.window.SupabaseStore(client,()=>changes++,()=>{});store.profile={company_id:'A',role:admin?'SUPER_ADMIN':'Gestionnaire'};store.ready=true;store.raw={stock:{old:{qty:7}}};
 return {store,ranges,changes:()=>changes};
}
(async()=>{
 for(const cap of [1000,200]){
  const t=setup({cap});await t.store.read(t.store.generation);const data=t.store.value();
  assert.equal(data.stock.length,63);assert.equal(data.notifications.length,1205);assert.equal(data.stock.reduce((sum,r)=>sum+r.qty,0),2016);assert.equal(t.changes(),1);
  assert.ok(!data.stock.some(r=>r.company_id==='B'));assert.ok(t.ranges.length>2);
 }
 const admin=setup({admin:true});await admin.store.read(admin.store.generation);assert.equal(admin.store.value().stock.length,64);
 const failed=setup({failAt:500});await assert.rejects(()=>failed.store.read(failed.store.generation),/Network failure/);assert.equal(failed.store.raw.stock.old.qty,7);assert.equal(failed.changes(),0,'Never publish a partial snapshot');
 const replaced=setup();await assert.rejects(()=>replaced.store.read(replaced.store.generation-1),/Session/);
 console.log('PASS: 1268 records loaded, B01 stock beyond first page, small server caps, tenant isolation, admin view, failed page preserves previous data, session isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
