// Uses local copies of the same ExcelJS/jsPDF bundles loaded by index.html.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve('.tools/report-libs');
for(const name of ['exceljs','jspdf','autotable'])assert.ok(fs.existsSync(path.join(root,name+'.js')),'Provide local test bundle: '+name);
const source=fs.readFileSync('index.html','utf8');
function extract(name){const start=source.indexOf('      async function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n      }',start)+8);}
const html=`<!doctype html><meta charset="utf-8"><input id="ai-chatbot-input"><script src="exceljs.js"></script><script src="jspdf.js"></script><script src="autotable.js"></script><script src="../../assets/assistant-reports.js"></script><script>
let currentUser={role:'Gestionnaire'},currentSectionId='cockpit',chatAssistantState={isThinking:false};
const data={users:[],stock:[{company_id:'A',op:'ITC-B02',label:'Câble réseau',type:'Réseau',qty:15},{company_id:'B',op:'ITC-B02',label:'Interdit',qty:999}],stockMovements:[]};
const secureStore={uid:'manager',ready:true,profile:{role:'Gestionnaire',company_id:'A',is_active:true,controlScopes:{'ITC-B02':true}},value:()=>data};
const ControlCore={scopes:v=>Object.keys(v)},normalizeOperatorKey=v=>v,getManagedOpsNormalized=()=>['ITC-B02'];
const messages=[],downloads=[],blobs=[];window.messages=messages;window.downloads=downloads;window.blobs=blobs;
const createURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{blobs.push(blob);return createURL(blob)};
HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
function appendChatAssistantMessage(role,content){messages.push({role,content})}function autoResizeChatAssistantInput(){}function setChatAssistantBusy(busy){chatAssistantState.isThinking=busy}
function aiParseAndExecuteAction(){throw new Error('Report wrongly routed to navigation')}function generateChatAssistantReply(){throw new Error('Report wrongly sent to provider')}
${extract('executeAssistantReport')}
${extract('handleChatAssistantSubmit')}
</script>`;
fs.writeFileSync(path.join(root,'test.html'),html+`<script src="../../assets/voice-assistant.js"></script><script>
let recognition,spoken=[],voiceStates=[];
const voice=new VoiceAssistant({host:{isSecureContext:true,SpeechRecognition:class{constructor(){recognition=this}start(){this.onstart?.()}abort(){}},SpeechSynthesisUtterance:class{constructor(text){this.text=text}},speechSynthesis:{cancel(){},getVoices:()=>[],speak:u=>spoken.push(u.text)}},getInput:()=>document.getElementById('ai-chatbot-input').value,setInput:v=>document.getElementById('ai-chatbot-input').value=v,session:()=>secureStore.uid,isBusy:()=>chatAssistantState.isThinking,onState:state=>voiceStates.push(state),onError:message=>{throw new Error(message)},onSubmit:()=>handleChatAssistantSubmit()});
const originalAppend=appendChatAssistantMessage;appendChatAssistantMessage=(role,text)=>{originalAppend(role,text);if(role==='assistant')voice.speak(text)};
function voiceCommand(text,confidence=.98){voice.start();const result=[{transcript:text,confidence}];result.isFinal=true;recognition.onresult({results:[result]})}
</script>`);
let chrome,ws;const pending=new Map();let seq=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){const v=await fn();if(v)return v;await delay(100)}throw new Error('Browser timeout');}
async function main(){
  const dir=path.resolve('.tools/report-browser-'+Date.now());fs.mkdirSync(dir,{recursive:true});
  chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const port=await until(()=>{try{return fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return null}});
  const url='file:///'+path.join(root,'test.html').replace(/\\/g,'/');
  const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(url),{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result)}};
  const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result?.value};
  await until(()=>evaluate('typeof handleChatAssistantSubmit === "function"'));
  for(const format of ['Excel','PDF']){
    await evaluate(`document.getElementById('ai-chatbot-input').value=${JSON.stringify('Exporte le stock ITC-B02 en '+format)};handleChatAssistantSubmit()`);
    assert.match(await evaluate('messages.at(-1).content'),/téléchargement a été déclenché/);
    const encoded=await evaluate(`new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blobs.at(-1))})`);
    const buffer=Buffer.from(encoded,'base64'),ext=format==='PDF'?'pdf':'xlsx';
    assert.equal(buffer.subarray(0,ext==='pdf'?4:2).toString(),ext==='pdf'?'%PDF':'PK');
    fs.writeFileSync(path.join(root,'rapport-test.'+ext),buffer);
  }
  assert.equal(await evaluate('downloads.length'),2);
  assert.equal(await evaluate('chatAssistantState.isThinking'),false);
  await evaluate(`document.getElementById('ai-chatbot-input').value='Exporte le stock ITC-B01 en PDF';handleChatAssistantSubmit()`);
  assert.match(await evaluate('messages.at(-1).content'),/hors de votre périmètre/);
  assert.equal(await evaluate('downloads.length'),2);
  // Read the actual workbook back with ExcelJS: data, labels and quantity survive serialization.
  const cells=await evaluate(`(async()=>{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await blobs[0].arrayBuffer());return workbook.worksheets[0].getSheetValues()})()`);
  assert.ok(JSON.stringify(cells).includes('Câble réseau'));assert.ok(!JSON.stringify(cells).includes('Interdit'));
  assert.ok(cells.some(row=>row&&row.includes(15)));
  await evaluate(`voiceCommand('Exporte le stock ITC-B02 en PDF')`);
  await until(()=>evaluate('downloads.length === 3'));
  assert.match(await evaluate('spoken.at(-1)'),/téléchargement a été déclenché/);
  assert.match(await evaluate('messages.at(-2).content'),/Exporte le stock ITC-B02 en PDF/);
  await evaluate(`voiceCommand('Exporte le stock ITC-B02 en PDF',.3)`);
  await until(()=>evaluate('voiceStates.at(-1) === "review"'));
  assert.equal(await evaluate('downloads.length'),3);
  console.log('PASS: typed and simulated voice commands generate real XLSX/PDF downloads, spoken success, scope rejection and preserved Excel content.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(ws)ws.close();if(chrome)chrome.kill()});
