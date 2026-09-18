const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const calls=[];let session={access_token:'test-session'},response={ok:true,status:200,json:async()=>({stores:{MOOV:{}}})};let clients=0;
const context={window:{localStorage:{getItem(){throw Error('Storage unavailable');}},supabase:{createClient:(url,key)=>{clients++;assert.ok(key.startsWith('sb_publishable_'));return {auth:{getSession:async()=>({data:{session},error:null})}};}}},fetch:async(...args)=>{calls.push(args);return response;}};
vm.createContext(context);
for(const file of ['supabase-public-config.js','supabase-config.js','cable-offcuts-transport.js'])vm.runInContext(fs.readFileSync('assets/'+file,'utf8'),context);
(async()=>{
 const call=context.window.CableOffcutsTransport.call;
 assert.ok(context.window.ITCSupabaseConfig.isConfigured);
 assert.ok((await call({action:'overview'})).stores.MOOV);
 assert.equal(clients,1);
 assert.equal(calls[0][0],'https://ufstydudgffhbkkjtbbg.supabase.co/functions/v1/cable-offcuts');
 assert.equal(calls[0][1].headers.Authorization,'Bearer test-session');
 assert.deepEqual(JSON.parse(calls[0][1].body),{action:'overview'});
 response={ok:false,status:403,json:async()=>({error:'Stock non autorise'})};await assert.rejects(()=>call({}),/non autorise/);
 session=null;await assert.rejects(()=>call({}),/Reconnectez/);
 console.log('PASS: shared Supabase configuration without local storage, single login client, authenticated edge call and permission/session errors.');
})().catch(e=>{console.error(e);process.exitCode=1;});
