// Navigation audit against isolated fixtures. Never connects to production APIs.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {spawn}=require('child_process');
const {createHash}=require('node:crypto');
const fixturePath=process.env.TAB_AUDIT_FIXTURE;
if(!fixturePath)throw Error('Set TAB_AUDIT_FIXTURE to a local, private snapshot (profiles, records, settings, offcuts).');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const profiles=fixture.profiles.filter(p=>p.is_active);
let server,chrome,ws;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const read=file=>fs.readFileSync(file,'utf8');
const backend=`
window.auditErrors=[];window.auditAlerts=[];window.auditWrites=[];
window.addEventListener('error',e=>auditErrors.push(e.message));window.addEventListener('unhandledrejection',e=>auditErrors.push(e.reason?.message||String(e.reason)));
window.alert=message=>auditAlerts.push(String(message));window.confirm=()=>false;
const auditSnapshot=${JSON.stringify(fixture).replace(/</g,'\\u003c')};
const emptySnap={val:()=>null,exists:()=>false};
const fakeRef=()=>({once:async()=>emptySnap,on:(event,callback)=>queueMicrotask(()=>callback(emptySnap)),off(){},child:fakeRef,update:async()=>{throw Error('Unexpected Firebase write during navigation')},set:async()=>{throw Error('Unexpected Firebase write during navigation')},push:fakeRef});
const fakeAuth=()=>({currentUser:null,onAuthStateChanged:()=>{},signOut:async()=>{},getUser:async()=>({data:{user:null}})});
window.firebase={initializeApp:()=>({auth:fakeAuth}),database:()=>({ref:fakeRef}),auth:fakeAuth,messaging:Object.assign(()=>({}),{isSupported:()=>false})};
const testClient={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getUser:async()=>({data:{user:null}})},
 from(name){let filters=[],start=0,end=Infinity,single=false;const q={select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},range(a,b){start=a;end=b;return this},maybeSingle(){single=true;return this},upsert:async()=>{throw Error('Unexpected setting write during navigation')},then(resolve,reject){let data=name==='app_profiles'?auditSnapshot.profiles:name==='app_records'?auditSnapshot.records:name==='app_settings'?auditSnapshot.settings:name==='stock_workflow_config'?[{company_id:window.auditProfile?.company_id,enabled:true}]:[];data=data.filter(row=>filters.every(([k,v])=>row[k]===v)).sort((a,b)=>String(a.collection).localeCompare(String(b.collection))||String(a.record_key).localeCompare(String(b.record_key))).slice(start,end+1);return Promise.resolve({data:single?(data[0]||null):data,error:null}).then(resolve,reject)}};return q;},
 async rpc(name,args){if(name==='workflow_managers')return {data:auditSnapshot.profiles.filter(p=>p.is_active&&p.role==='Gestionnaire'&&p.company_id===auditProfile.company_id).map(p=>({uid:p.user_id,name:p.profile.name,scopes:p.control_scopes})),error:null};
 if(name==='save_app_changes'){for(const change of args.changes){auditWrites.push(change.collection);if(change.collection!=='notifications')throw Error('Navigation attempted to save '+change.collection);const record=auditSnapshot.records.find(r=>r.collection===change.collection&&r.record_key===change.record_key);if(record)record.payload=structuredClone(change.payload);}return {data:null,error:null};}throw Error('Unexpected RPC '+name);}
};
window.supabase={createClient:()=>testClient};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,options)=>{const target=new URL(String(url),location.href);if(target.origin!==location.origin)throw Error('External API blocked by navigation audit');return nativeFetch(url,options);};
Object.defineProperty(navigator,'serviceWorker',{value:undefined,configurable:true});
`;
async function main(){
 const vendor=new Map(),cache=path.resolve('.tools/tab-audit-libs');fs.mkdirSync(cache,{recursive:true});
 const external=[...read('index.html').matchAll(/<script src="(https:[^"]+)"[^>]*><\/script>/g)].map(m=>m[1])
  .filter(url=>!url.includes('firebasejs')&&!url.includes('@supabase/')&&!url.includes('cdn.tailwindcss.com'));
 const fetched=await Promise.allSettled(external.map(async url=>{const name=createHash('sha256').update(url).digest('hex')+'.js',file=path.join(cache,name);if(!fs.existsSync(file)){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Library HTTP '+response.status+' '+new URL(url).hostname);fs.writeFileSync(file,await response.text());}vendor.set(url,{route:'/_vendor/'+name,file});}));
 for(const result of fetched)if(result.status==='rejected')throw result.reason;
 server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;
  const library=[...vendor.values()].find(v=>v.route===route);if(library){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(library.file));}
  if(route==='/test-backend.js'){res.setHeader('Content-Type','application/javascript');return res.end(backend);}
  if(route==='/'){
   let html=read('index.html').replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^\"]+"><\/script>/g,'')
    .replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','')
    .replace('<head>','<head><script src="/test-backend.js"></script><style>.hidden{display:none!important}</style>')
    .replaceAll('if ("serviceWorker" in navigator)', 'if (navigator.serviceWorker)')
    .replace('<script src="https://cdn.tailwindcss.com"></script>','');
   for(const [url,local] of vendor)html=html.replaceAll('src="'+url+'"','src="'+local.route+'"');
   res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
  }
  const file=path.resolve('.'+route);if(!file.startsWith(path.resolve('assets')+path.sep)){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const dir=path.resolve('.tools/all-tabs-browser-'+Date.now());fs.mkdirSync(dir,{recursive:true});
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100&&!port;i++){try{port=read(path.join(dir,'DevToolsActivePort')).split('\n')[0]}catch{await pause(100)}}
 if(!port)throw Error('Chrome unavailable');
 const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent('http://127.0.0.1:'+server.address().port),{method:'PUT'})).json();
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let sequence=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
 const evaluate=async expression=>{const id=++sequence;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser timeout')),20000);pending.set(id,m=>{clearTimeout(timer);resolve(m)});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});if(result.result?.exceptionDetails)throw Error(result.result.exceptionDetails.exception?.description||'Browser exception');return result.result?.result?.value;};
 for(let i=0;i<200;i++){if(await evaluate('typeof renderMonProfil==="function" && typeof secureStore!=="undefined"'))break;await pause(250);if(i===199)throw Error('Application loading failed');}
 const startup=await evaluate('auditErrors');assert.deepEqual(startup,[],'startup errors');
 const results=[];let tabCount=0,detailCount=0;
 for(const profile of profiles){
  await evaluate(`(async()=>{StockControl.reset();CableOffcuts.stop();secureStore.stop();currentUser=null;currentSectionId='';window.auditProfile=${JSON.stringify(profile)};
   secureStore.profile={...auditProfile.profile,role:auditProfile.role,uid:auditProfile.firebase_uid||auditProfile.user_id,company_id:auditProfile.company_id,controlScopes:auditProfile.control_scopes,controlScopeKeys:auditProfile.control_scope_keys,validatorWorkflowEnabled:true};secureStore.uid=auditProfile.user_id;
   await secureStore.read(secureStore.generation);secureStore.ready=true;appData=normalizeAppData(secureStore.value());currentUser={...secureStore.profile};
   document.getElementById('login-screen').classList.add('hidden');document.getElementById('main-app').classList.remove('hidden');updateMenuVisibility();
   CableOffcutsTransport.call=async command=>{if(command.action!=='overview')throw Error('Unexpected offcut write');const stores={};for(const s of auditSnapshot.offcuts||[])if(s.company_id===auditProfile.company_id)stores[s.op]=s.state;for(const stock of appData.stock){if(['Superviseur','Validateur','Contrôleur','SUPER_ADMIN'].includes(auditProfile.role)||auditProfile.control_scopes?.[stock.op])stores[stock.op]||={lots:{},requests:{},returns:{},events:{}};}return {stores,sources:[],workflowEnabled:true,userId:auditProfile.user_id,managers:[]};};
   auditErrors.length=0;auditAlerts.length=0;auditWrites.length=0;
  })()`);
  const sections=await evaluate(`(()=>{const sections=new Set(['mon-profil']);for(const el of document.querySelectorAll('#sidebar [onclick]')){if(el.closest('.hidden'))continue;for(const m of el.getAttribute('onclick').matchAll(/showSection\\(['"]([^'"]+)['"]\\)/g))sections.add(m[1]);}if(!document.getElementById('menu-cable-offcuts').classList.contains('hidden'))sections.add('stocks-chutes');if(ValidatorWorkflow.isValidator())sections.add('validation-bons');if(!document.getElementById('menu-stock-control').classList.contains('hidden'))for(const s of ['dashboard','stock','flows','missions','inventories','audits','anomalies','actions','reports','notifications'])sections.add('control-'+s);return [...sections]})()`);
  for(const section of sections){
   tabCount++;
   let exception=null;try{await evaluate(`auditErrors.length=0;auditAlerts.length=0;showSection(${JSON.stringify(section)});true`);await pause(80);await evaluate('pendingSave||Promise.resolve()');}catch(e){exception=e.message;}
   const result=await evaluate(`(()=>{for(const el of document.querySelectorAll('#app-container [onclick],#app-container [onchange],#app-container [onsubmit]'))for(const name of ['onclick','onchange','onsubmit']){if(el.hasAttribute(name))try{new Function('event',el.getAttribute(name))}catch(error){auditErrors.push('Invalid '+name+' handler: '+error.message)}}return {errors:[...auditErrors],alerts:[...auditAlerts],empty:!document.getElementById('app-container').textContent.trim(),unavailable:/en cours de déploiement|Chargement impossible|Accès réservé|La librairie caméra n.a pas été chargée/.test(document.getElementById('app-container').textContent)}})()`);
   if(exception||result.errors.length||result.alerts.length||result.empty||result.unavailable)results.push({role:profile.role,account:profile.user_id,section,exception,...result});
   if(section==='flux-materiels'){
    const materials=await evaluate(`Array.from(document.querySelectorAll('#app-container [data-flux-designation]')).map(el=>el.dataset.fluxDesignation)`);
    for(const material of materials){detailCount++;try{await evaluate('auditErrors.length=0;auditAlerts.length=0;renderFluxMaterielDetail(document.getElementById("app-container"),'+JSON.stringify(material)+')');const errors=await evaluate('[...auditErrors,...auditAlerts]');if(errors.length)throw Error(errors.join('; '));}catch(e){results.push({role:profile.role,section:'flux-detail',exception:e.message});}}
   }
  }
  console.log(profile.role+' : '+sections.length+' onglets examinés.');
 }
 fs.writeFileSync('.tools/tab-audit-results.json',JSON.stringify({profiles:profiles.length,tabs:tabCount,details:detailCount,failures:results},null,2));
 if(results.length){console.log(JSON.stringify(results.slice(0,12),null,2));throw Error(results.length+' navigation failures (full report in .tools/tab-audit-results.json)');}
 console.log('PASS: '+tabCount+' tab visits and '+detailCount+' material details across '+profiles.length+' active profiles; no stock or request writes.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{ws?.close();chrome?.kill();server?.close()});
