// Browser integration test against the real RTDB emulator; no production services.
const fs = require('fs');
const path = require('path');
const http = require('http');
const {spawn} = require('child_process');
const assert = require('node:assert/strict');
const {initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const C = require('../assets/control-core');
const project = 'demo-control-browser';
let environment, server, chrome;
const sockets = [];
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn, title) { for(let i=0;i<100;i++){const result=await fn();if(result)return result;await delay(100);}throw new Error('Timeout: '+title); }
function fixture(user) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/stock-control.css"><style>body{margin:0;background:#f1f5f9;font-family:Arial}button{border:0;cursor:pointer}*{box-sizing:border-box}#view-title{padding:10px}</style></head><body><h1 id="view-title"></h1><main id="app-container"></main>
  <script src="/firebase-app-compat.js"></script><script src="/firebase-database-compat.js"></script><script src="/assets/control-core.js"></script><script src="/assets/secure-store.js"></script>
  <script>firebase.initializeApp({projectId:'${project}',databaseURL:'http://127.0.0.1:9000/?ns=${project}'});const db=firebase.database();db.useEmulator('127.0.0.1',9000,{mockUserToken:{sub:'${user}',user_id:'${user}'}});let appData={},currentUser={},currentSectionId='control-dashboard';const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const secureStore=new SecureStore(db,data=>{appData=data},error=>{window.testError=error.message});function showSection(id){currentSectionId=id;StockControl.enter(id)};</script>
  <script src="/assets/stock-control.js"></script><script>secureStore.connect({uid:'${user}'}).then(data=>{appData=data;currentUser={...data.users.find(u=>u.uid==='${user}'),...secureStore.profile};showSection('control-dashboard');window.ready=true}).catch(e=>window.testError=e.message)</script></body></html>`;
}
async function page(port,user) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(server.url+'/?user='+user)}`,{method:'PUT'})).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let seq=0;const pending=new Map();
  ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(new Error(v.error.message)):p.resolve(v.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await until(()=>evaluate('window.ready || window.testError'),'load '+user);
  assert.equal(await evaluate('window.testError || null'),null);
  await until(()=>evaluate('!!document.querySelector("[data-action=new]") || document.body.innerText.includes("Travail à traiter")'),'dashboard');
  return {send,evaluate,click:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),wait:selector=>until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),selector),submit:async(selector,values)=>{
    await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});for(const [k,v] of Object.entries(${JSON.stringify(values)})) f.elements.namedItem(k).value=v;f.requestSubmit();})()`);
    await until(()=>evaluate('document.getElementById("ctl-message").textContent'), 'save response');
    assert.equal(await evaluate('document.getElementById("ctl-message").textContent'),'Enregistrement effectué.');
  }};
}
async function main(){
  environment=await initializeTestEnvironment({projectId:project,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.json','utf8')}});
  const profiles=Object.fromEntries([['controller','Contrôleur'],['manager','Gestionnaire'],['supervisor','Superviseur']].map(([uid,role])=>[uid,{uid,role,email:uid+'@example.test',company_id:'A',is_active:true,user_id:uid,controlScopes:C.scopeMap(['ITC-B01']),controlScopeKeys:C.scopeKeys('A',['ITC-B01'])}]));
  await environment.withSecurityRulesDisabled(c=>c.database().ref().set({auth_profiles:profiles,tenant_branding:{A:{id:'A',name:'Démo',status:'active'}},itc_data:{users:Object.fromEntries(Object.entries(profiles).map(([uid,p])=>[uid,{...p,id:uid,name:uid,managedOps:['ITC-B01']}])),stock:{cable:{company_id:'A',op:'ITC-B01',scope_key:'A|ITC-B01',label:'Câble fibre optique',type:'Réseau',qty:100},tools:{company_id:'A',op:'ITC-B01',scope_key:'A|ITC-B01',label:'Pince à sertir',type:'Outillage',qty:12}}}}));
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/'){const user=url.searchParams.get('user');if(!profiles[user]){res.writeHead(400).end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture(user));return;}
    const relative=url.pathname.startsWith('/assets/')?url.pathname.slice(1):['/firebase-app-compat.js','/firebase-database-compat.js'].includes(url.pathname)?'node_modules/firebase'+url.pathname:null;
    if(!relative || relative.includes('..')){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',relative.endsWith('.css')?'text/css':'application/javascript');fs.createReadStream(path.resolve(relative)).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.url='http://127.0.0.1:'+server.address().port;
  const profileDir=path.resolve('.tools/control-browser-'+Date.now());fs.mkdirSync(profileDir,{recursive:true});
  chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profileDir,'about:blank'],{windowsHide:true,stdio:'ignore'});
  chrome.on('error',e=>{console.error(e);process.exitCode=1});
  const port=await until(()=>{try{return fs.readFileSync(path.join(profileDir,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return null}},'Chrome');
  const controller=await page(port,'controller');
  await controller.click('[data-action=new][data-kind=inventories]');
  await controller.submit('[data-mode=create]',{title:'Inventaire septembre',assignee:'Gestionnaire B01'});
  await controller.wait('[data-mode=start]');
  await controller.evaluate('document.getElementById("ctl-message").textContent=""');
  await controller.submit('[data-mode=start]',{});
  await controller.wait('[name=count-cable]');
  await controller.evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['%PDF-1.4 test fixture'], 'preuve.pdf', {type:'application/pdf'}));document.querySelector('[name=file]').files=transfer.files;document.getElementById('ctl-message').textContent='';})()`);
  await controller.submit('[data-mode=attachment]',{});
  assert.equal(await controller.evaluate('document.body.innerText.includes("preuve.pdf")'),true);
  await controller.evaluate('document.getElementById("ctl-message").textContent=""');
  await controller.submit('[data-mode=counts]',{'count-cable':'98','count-tools':'12','note-cable':'Deux unités manquantes'});
  const manager=await page(port,'manager');
  await manager.click('[data-page=inventories]');await manager.wait('[data-action=open]');await manager.click('[data-action=open]');
  await manager.submit('[data-mode=counts]',{'manager-cable':'98','manager-tools':'12'});
  await manager.evaluate('document.getElementById("ctl-message").textContent=""');
  await manager.submit('[data-mode=managerResponse]',{text:'Accord sur le comptage. Deux unités manquantes.'});
  await controller.evaluate('document.getElementById("ctl-message").textContent=""');
  await controller.click('[data-action=submit-inventory]');
  await until(()=>controller.evaluate('document.body.innerText.includes("À approuver")'),'inventory submitted');
  const supervisor=await page(port,'supervisor');
  await supervisor.click('[data-page=inventories]');await supervisor.wait('[data-action=open]');await supervisor.click('[data-action=open]');
  await supervisor.submit('[data-mode=approve]',{text:'Écart validé après recherche.',status:'approved'});
  await supervisor.wait('[data-action=apply-inventory]');await supervisor.click('[data-action=apply-inventory]');
  await until(()=>supervisor.evaluate('document.body.innerText.includes("Clôturé")'),'closed');
  const report=await supervisor.send('Page.printToPDF',{printBackground:true});
  assert.ok(Buffer.from(report.data,'base64').length>1000);
  await environment.withSecurityRulesDisabled(async c=>{assert.equal((await c.database().ref('itc_data/stock/cable/qty').once('value')).val(),98);assert.equal((await c.database().ref('stock_control/A/ITC-B01/lock').once('value')).exists(),false);});
  for(const section of ['stock','flows','missions','audits','anomalies','actions','reports','notifications']){
    await controller.click(`[data-page=${section}]`);
    await until(()=>controller.evaluate(`document.getElementById('view-title').textContent !== ''`),'section '+section);
    assert.equal(await controller.evaluate('window.testError || null'),null);
  }
  await controller.click('[data-page=flows]');await controller.wait('[data-action=new-transfer]');await controller.click('[data-action=new-transfer]');
  await controller.submit('[data-mode=create]',{title:'Transfert documenté',toStock:'ITC-B02',sentQty:'10'});
  await controller.submit('[data-mode=update]',{receivedQty:'9',status:'anomaly',description:'Une unité manquante',evidence:'Bon de réception vérifié'});
  assert.equal(await controller.evaluate('document.body.innerText.includes("Écart : -1")'),true);
  await controller.click('[data-page=dashboard]');
  await until(()=>controller.evaluate('document.body.innerText.includes("TABLEAU DE BORD CONTRÔLEUR")'),'controller dashboard');
  assert.equal(await controller.evaluate('document.body.innerText.includes("98")'),false); // Dashboard exposes conformity, not raw inventory quantities.
  assert.equal(await controller.evaluate('document.body.innerText.includes("50 %")'),true);
  assert.equal(await controller.evaluate('document.querySelectorAll(".ctl-chart-bars").length'),2);
  assert.equal(await controller.evaluate('document.querySelector(".ctl-conformity-chart svg").getAttribute("aria-label")'),'1 Conformes, 1 En écart, 0 Non évaluables');
  assert.equal(await controller.evaluate('document.querySelectorAll(".ctl-chart-legend li").length'),3);
  await controller.click('.ctl-chart-row[data-page=anomalies]');
  assert.equal(await controller.evaluate('document.getElementById("view-title").textContent'),'Anomalies et régularisations');
  await controller.click('[data-page=dashboard]');
  await environment.withSecurityRulesDisabled(c=>c.database().ref().update({
    'itc_data/stock/second':{company_id:'A',op:'ITC-B02',scope_key:'A|ITC-B02',label:'Second stock',qty:4},
    'stock_control/A/ITC-B01/anomalies/critical':{title:'Urgence magasin',status:'open',severity:'Critique',createdBy:'controller',createdAt:'2026-09-15'},
    'stock_control/A/ITC-B01/actions/verify':{title:'Rangement à vérifier',status:'verify',createdBy:'controller',createdAt:'2026-09-15',due:'2000-01-01',response:{text:'Réalisé',by:'manager',at:'2026-09-15'}},
    'stock_control/A/ITC-B02/missions/other':{title:'Mission second stock',status:'open',createdBy:'controller',createdAt:'2026-09-15'},
  }));
  await until(()=>controller.evaluate('appData.stock.some(s=>s.op==="ITC-B02")'),'second stock loaded');
  await controller.click('[data-page=dashboard]');
  await until(()=>controller.evaluate('document.body.innerText.includes("Urgence magasin") && !!document.querySelector("[data-action=dashboard-stock][data-op=ITC-B02]")'),'dashboard priorities');
  assert.equal(await controller.evaluate('document.querySelector(".ctl-controller-metrics [data-page=actions] strong").textContent'),'1');
  await controller.click('[data-action=open][data-id=critical]');
  assert.equal(await controller.evaluate('document.body.innerText.includes("Gravité : Critique")'),true);
  await controller.click('[data-action=back]');
  await controller.click('[data-action=dashboard-stock][data-op=ITC-B02]');
  assert.equal(await controller.evaluate('document.getElementById("ctl-op").value'),'ITC-B02');
  assert.equal(await controller.evaluate('document.body.innerText.includes("Mission second stock")'),true);
  assert.equal(await controller.evaluate('document.body.innerText.includes("Urgence magasin")'),false);
  assert.equal(await controller.evaluate('document.body.innerText.includes("Aucun inventaire clôturé")'),true);
  assert.equal(await controller.evaluate('document.querySelector(".ctl-conformity-chart") === null'),true);
  await controller.click('[data-action=open][data-id=other]');
  assert.equal(await controller.evaluate('document.body.innerText.includes("Mission second stock")'),true);
  await controller.click('[data-action=back]');
  await controller.click('[data-action=dashboard-stock][data-op=ITC-B01]');
  await controller.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const desktop=await controller.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.tools/control-dashboard-desktop.png',Buffer.from(desktop.data,'base64'));
  await controller.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await delay(250);
  assert.equal(await controller.evaluate('document.documentElement.scrollWidth <= 390'),true);
  const shot=await controller.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.tools/control-mobile.png',Buffer.from(shot.data,'base64'));
  console.log('PASS: inventory workflow, controller dashboard metrics, priorities, stock switching, dossier links, empty states, all tabs and mobile layout.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{for(const ws of sockets)ws.close();if(chrome)chrome.kill();if(server)server.close();if(environment)await environment.cleanup();});
