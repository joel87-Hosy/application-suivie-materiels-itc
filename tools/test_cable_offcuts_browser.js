const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {spawn}=require('child_process');
let core;
let server,chrome,state={},counter=0;const sockets=[];
const actors=Object.fromEntries(['Technicien','Coordinateur','Gestionnaire','Validateur','Contrôleur','Superviseur'].map(role=>[role,{uid:role,user_id:role,name:role,role,company_id:'A',is_active:true,controlScopes:{MOOV:true}}]));
const source={key:'sortie:s:0',sortieKey:'s',itemIndex:0,op:'MOOV',label:'Câble 1FO',materialType:'CÂBLE',issuedQty:100,reference:'BON-ORIGINE'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let n=0;n<100;n++){const value=await fn();if(value)return value;await pause(100);}throw Error('Timeout '+label);}
function html(role){return `<!doctype html><meta charset="utf-8"><main id="app"></main><script>
const role=${JSON.stringify(role)};
window.confirm=()=>true;
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:role}},error:null})}})};
localStorage.clear();
const originalFetch=window.fetch.bind(window);window.fetch=async(url,options)=>{if(String(url).includes('/functions/v1/cable-offcuts')){const response=await originalFetch('/call',{method:'POST',body:JSON.stringify({role,data:JSON.parse(options.body)})});const result=await response.json();return new Response(JSON.stringify(result),{status:result.error?400:200});}return originalFetch(url,options);};
window.pdfSaves=[];window.jspdf={jsPDF:class{setFontSize(){}text(){}autoTable(){}save(name){pdfSaves.push(name);}}};
</script><script src="/public-config.js"></script><script src="/config.js"></script><script src="/transport.js"></script><script src="/module.js"></script><script>CableOffcuts.setup({profile:()=>({role,company_id:'A'})});CableOffcuts.enter(document.getElementById('app'));</script>`;}
async function page(port,role){
 const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(server.url+'/?role='+encodeURIComponent(role)),{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)(m);pending.delete(m.id);}};
 const evaluate=async expression=>{const id=++seq;const result=await new Promise(resolve=>{pending.set(id,resolve);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result?.result?.value;};
 await until(()=>evaluate('!!document.getElementById("chute-op")'),'load');
 const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
 const saved=async()=>{await until(()=>evaluate('!CableOffcuts.isBusy() && document.getElementById("chute-message")?.textContent'),'save');assert.equal(await evaluate('document.getElementById("chute-message").textContent'),'Opération enregistrée et tracée.');};
 return {evaluate,click,refresh:async()=>{await click('[data-action=refresh]');await until(()=>evaluate('!!document.getElementById("chute-op")'),'refresh');},action:async action=>{await click('[data-action='+action+']');await saved();},submit:async(action,values)=>{await evaluate(`(()=>{const f=document.querySelector('[data-command=${action}]');for(const [key,value] of Object.entries(${JSON.stringify(values)}))f.elements.namedItem(key).value=value;f.requestSubmit();})()`);await saved();}};
}
async function main(){
 core=await import('../supabase/functions/cable-offcuts/core.ts');
 server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/module.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('assets/cable-offcuts.js'));}
  if(url.pathname==='/transport.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('assets/cable-offcuts-transport.js'));}
  if(url.pathname==='/public-config.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('assets/supabase-public-config.js'));}
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync('assets/supabase-config.js'));}
  if(url.pathname==='/call'){let body='';for await(const chunk of req)body+=chunk;const {role,data}=JSON.parse(body);try{if(data.action==='overview')return res.end(JSON.stringify({stores:{MOOV:state},sources:role==='Technicien'?[source]:[],workflowEnabled:true,userId:role,managers:[{uid:'Gestionnaire',name:'Gestionnaire',scopes:{MOOV:true}}]}));state=await core.transition(state,data,actors[role],{op:'MOOV',company:'A',now:new Date().toISOString(),id:data.commandId,source,workflowEnabled:true,assignedManager:actors[data.managerUid]});counter++;res.end(JSON.stringify({ok:true}));}catch(e){res.end(JSON.stringify({error:e.message}));}return;}
  res.end(html(url.searchParams.get('role')));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));server.url='http://127.0.0.1:'+server.address().port;
 const dir=path.resolve('.tools/chutes-browser-'+Date.now());fs.mkdirSync(dir,{recursive:true});
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const port=await until(()=>{try{return fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{return null;}},'Chrome');
 const tech=await page(port,'Technicien');await tech.submit('return',{source:'sortie:s:0',qty:'40.5',motif:'Fin chantier'});
 const ret=Object.keys(state.returns)[0];assert.equal(Object.keys(state.lots).length,0);
 const coord=await page(port,'Coordinateur');await coord.action('approveReturn');
 const manager=await page(port,'Gestionnaire');await manager.action('receiveReturn');
 assert.equal(state.lots['return-'+ret].qty,40.5);
 await manager.submit('manualEntry',{label:'Câble existant',qty:'12.25',motif:'Entrepôt'});
 await tech.refresh();await tech.submit('request',{lotId:'return-'+ret,qty:'10.25',motif:'Nouveau chantier'});
 await coord.refresh();await coord.action('approveRequest');await manager.refresh();
 assert.equal(await manager.evaluate('document.querySelectorAll("[data-action=issue]").length'),0);
 const validator=await page(port,'Validateur');await validator.evaluate('document.querySelector("[data-manager]").value="Gestionnaire"');await validator.action('validateRequest');
 await manager.refresh();await manager.action('issue');
 assert.equal(state.lots['return-'+ret].qty,30.25);
 await tech.refresh();await tech.click('[data-action=bon]');assert.equal(await tech.evaluate('pdfSaves.length'),1);
 await tech.submit('return',{source:'issue:'+Object.keys(state.requests)[0],qty:'2',motif:'Seconde chute'});
 for(const role of ['Contrôleur','Validateur']){const viewer=await page(port,role);assert.equal(await viewer.evaluate('document.querySelectorAll("form, [data-action=receiveReturn], [data-action=issue]").length'),0);assert.match(await viewer.evaluate('document.body.textContent'),/BON-ORIGINE/);}
 assert.equal(counter,9);
 console.log('PASS: browser return unchanged, manual entry, reuse → coordination → validator → manager issue, PDF provenance, second return and read-only stock visibility.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const ws of sockets)ws.close();chrome?.kill();server?.close();});
