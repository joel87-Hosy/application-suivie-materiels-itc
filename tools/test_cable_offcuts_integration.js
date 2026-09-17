// Real RTDB transactions and callable authorization, restricted to an emulator.
const assert=require('node:assert/strict');
const fs=require('fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Database emulator required.');
const project='demo-itc-security';
const functionsRequire=require('node:module').createRequire(require('node:path').resolve('functions/index.js'));
const admin=functionsRequire('firebase-admin/app');
const {getDatabase}=functionsRequire('firebase-admin/database');
admin.initializeApp({projectId:project,databaseURL:'https://'+project+'-default-rtdb.firebaseio.com'});
const endpoint=require('../functions/cable-offcuts').cableOffcuts;
let environment;
async function main(){
 environment=await initializeTestEnvironment({projectId:project,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.json','utf8')}});
 const profiles=Object.fromEntries([['tech','Technicien'],['coord','Coordinateur'],['manager','Gestionnaire'],['controller','Contrôleur'],['supervisor','Superviseur'],['otherManager','Gestionnaire']].map(([uid,role],i)=>[uid,{uid,role,is_active:true,company_id:'A',user_id:i+1,controlScopes:{[uid==='otherManager'?'ITC-B01':'MOOV']:true}}]));
 const db=getDatabase();
 await db.ref().set({auth_profiles:profiles,tenant_branding:{A:{status:'active'}},itc_data:{users:Object.fromEntries(Object.entries(profiles).map(([uid,p])=>[uid,{...p,id:p.user_id,name:uid,managedOps:Object.keys(p.controlScopes)}])),stock:{c:{company_id:'A',op:'MOOV',label:'Câble 1FO',type:'CÂBLE',qty:500}},sorties:{s:{company_id:'A',op:'MOOV',technicienUid:'tech',ref:'NORMAL-1',items:[{label:'Câble 1FO',qty:100}]}}}});
 const call=(uid,data)=>endpoint.run({auth:{uid},data});
 const invoke=(uid,action,commandId,extra={})=>call(uid,{action,commandId,op:'MOOV',...extra});
 // Existing team profiles can lack the newer security scope map.
 await db.ref('auth_profiles/tech/controlScopes').remove();
 const overview=await call('tech',{action:'overview'});
 assert.equal(overview.sources.length,1);assert.ok(overview.stores.MOOV);
 assert.deepEqual(Object.keys((await call('otherManager',{action:'overview'})).stores),['ITC-B01']);
 await assert.rejects(()=>invoke('otherManager','manualEntry','forbidden',{label:'Câble',qty:1,motif:'Test'}));
 await invoke('tech','return','r1',{sortieKey:'s',itemIndex:0,qty:40.5,motif:'Reste chantier'});
 await assert.rejects(()=>invoke('manager','receiveReturn','early',{target:'r1'}));
 await invoke('coord','approveReturn','a1',{target:'r1'});
 await Promise.all([invoke('manager','receiveReturn','receive',{target:'r1'}),invoke('manager','receiveReturn','receive',{target:'r1'})]);
 assert.equal((await db.ref('cable_offcuts/A/MOOV/lots/return-r1/qty').get()).val(),40.5);
 for(const [id,qty] of [['q1',30],['q2',30]]){await invoke('tech','request',id,{lotId:'return-r1',qty,motif:'Réutilisation'});await invoke('coord','approveRequest','a-'+id,{target:id});}
 const results=await Promise.allSettled([invoke('manager','issue','i1',{target:'q1'}),invoke('manager','issue','i2',{target:'q2'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Concurrent issues cannot overdraw');
 assert.equal((await db.ref('cable_offcuts/A/MOOV/lots/return-r1/qty').get()).val(),10.5);
 await invoke('manager','manualEntry','manual',{label:'Câble 2FO',qty:12.25,motif:'Chute existante entrepôt'});
 const controller=await call('controller',{action:'overview'});assert.ok(controller.stores.MOOV.events.manual);
 await assert.rejects(()=>invoke('controller','manualEntry','bad-controller',{label:'Câble',qty:1,motif:'Test'}));
 await assertFails(environment.authenticatedContext('manager').database().ref('cable_offcuts/A/MOOV/lots/manual/qty').set(999));
 assert.equal((await db.ref('itc_data/stock/c/qty').get()).val(),500,'Normal stock remains unchanged');
 assert.ok(Object.values((await db.ref('itc_data/notifications').get()).val()).some(n=>n.offcut&&n.userId===profiles.coord.user_id));
 console.log('PASS: callable auth/scopes, source proof, real atomic reception/retry, concurrent withdrawals, controller reports, notifications and direct-write denial.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(environment)await environment.cleanup();await admin.deleteApp(admin.getApp());});
