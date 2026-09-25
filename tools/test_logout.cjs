const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n      }',start)+8);}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function setup({push='pending',auth='pending',cleanupThrows=false}={}){
 const pending=deferred(),events=[];
 const elements=Object.fromEntries(['main-app','login-screen','app-container','login-password'].map(id=>[id,{innerHTML:'private',value:'secret',classList:{hidden:id==='login-screen',add(){this.hidden=true},remove(){this.hidden=false}}}]));
 const storage=new Map();
 const context={console:{warn(){},error(){}},Promise,currentUser:{id:1},appData:{private:true},authStateGeneration:1,logoutRequested:false,logoutPromise:null,useSupabaseBackend:true,
  document:{getElementById:id=>elements[id]},sessionStorage:{setItem:(k,v)=>storage.set(k,v)},clearPrivateLocalData:()=>events.push('clear-private'),emptyAppData:()=>({}),
  stopVoiceAssistant:()=>{if(cleanupThrows)throw Error('voice failed')},secureStore:{stop:()=>events.push('stop-store')},
  window:{disablePushNotifications:()=>push==='reject'?Promise.reject(Error('push failed')):new Promise(()=>{}),ITCSupabaseConfig:{clearLocalSession:()=>events.push('clear-token')},ManagerLocations:{stop:()=>events.push('stop-locations')}},
  supabaseBackend:{auth:{signOut:options=>{events.push('supabase-'+options.scope);return auth==='reject'?Promise.resolve({error:Error('offline')}):pending.promise}}},
  firebase:{auth:()=>({signOut:async()=>events.push('firebase')})},
 };
 vm.createContext(context);vm.runInContext(['signOutActiveAuth','logout'].map(extract).join('\n'),context);
 return {context,elements,events,pending,storage};
}
(async()=>{
 const t=setup({cleanupThrows:true});const task=t.context.logout();
 assert.equal(t.elements['main-app'].classList.hidden,true,'private UI closes synchronously');
 assert.equal(t.elements['login-screen'].classList.hidden,false,'login immediately visible');
 assert.equal(t.elements['app-container'].innerHTML,'');assert.equal(t.elements['login-password'].value,'');
 assert.equal(t.context.currentUser,null);assert.equal(t.context.authStateGeneration,2);assert.equal(t.storage.get('itc_signed_out'),'1');
 assert.equal(t.context.logout(),task,'double click reuses pending logout');
 await Promise.resolve();assert.ok(t.events.includes('supabase-local'));assert.ok(t.events.includes('firebase'),'push cannot block either auth provider');
 t.pending.resolve({error:null});await task;assert.ok(t.events.includes('clear-token'));assert.equal(t.context.logoutPromise,null);
 const offline=setup({push:'reject',auth:'reject'});await offline.context.logout();
 assert.equal(offline.elements['main-app'].classList.hidden,true);assert.ok(offline.events.includes('clear-token'));assert.ok(offline.events.includes('firebase'));
 // A pending user lookup cannot reopen the data store after logout.
 const lookup=deferred();let connections=0;
 const stale={authStateGeneration:1,logoutRequested:false,getActiveAuthUser:()=>lookup.promise,secureStore:{connect:()=>{connections++;}}};
 vm.createContext(stale);vm.runInContext(extract('refreshAppDataFromServer'),stale);
 const read=stale.refreshAppDataFromServer();stale.authStateGeneration++;stale.logoutRequested=true;lookup.resolve({id:1});
 await assert.rejects(read,/Session fermée/);assert.equal(connections,0);
 // Network timeout cancels Supabase logout and leaves ordinary requests intact.
 let options,timer,requestSignal;const removed=[];
 const config={URL,AbortController,Promise,Error,setTimeout:fn=>{timer=fn;return 1},clearTimeout(){},
  ITCSupabasePublicConfig:{projectUrl:'https://test.supabase.co',publishableKey:'public'},
  localStorage:{getItem:()=>null,removeItem:key=>removed.push(key)},sessionStorage:{getItem:()=> '1'},
  supabase:{createClient:(url,key,opts)=>{options=opts;return {}}},fetch:(url,opts)=>{requestSignal=opts.signal;return new Promise(()=>{})}};
 config.window=config;vm.createContext(config);vm.runInContext(fs.readFileSync('assets/supabase-config.js','utf8'),config);
 assert.ok(removed.includes('sb-test-auth-token'),'reload during logout clears saved session before creating client');
 const fetch=options.global.fetch('https://test.supabase.co/auth/v1/logout?scope=local',{});timer();
 await assert.rejects(fetch,/Délai/);assert.equal(requestSignal.aborted,true);
 config.fetch=async()=> 'ordinary';assert.equal(await options.global.fetch('https://test.supabase.co/rest/v1/app_records',{}),'ordinary');
 console.log('PASS: immediate logout, double click, failed/hanging push cleanup, offline token removal, stale lookup cancellation, reload protection and bounded auth request.');
})().catch(error=>{console.error(error);process.exitCode=1});
