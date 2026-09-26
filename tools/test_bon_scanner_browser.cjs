// Real QR/PDF rendering and browser UI against an isolated, synthetic backend.
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
let chrome,ws;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'itc-bon-scanner-'));
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100&&!port;i++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{await pause(100)}}
 if(!port)throw Error('Chrome unavailable');
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let sequence=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
 const evaluate=async expression=>{const id=++sequence;const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser timeout')),20000);pending.set(id,m=>{clearTimeout(timer);resolve(m)});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});if(result.result?.exceptionDetails)throw Error(result.result.exceptionDetails.exception?.description||'Browser exception');return result.result?.result?.value;};
 for(const file of ['assets/bon-reference.js','assets/bon-scanner.js','assets/bon-signatures.js','.tools/report-libs/qrcode.js','.tools/report-libs/jspdf.js','.tools/report-libs/autotable.js','.tools/report-libs/jsqr.js'])await evaluate(fs.readFileSync(file,'utf8'));
 await evaluate(fs.readFileSync('assets/validator-workflow.js','utf8')+'\nwindow.TestValidatorWorkflow=window.ValidatorWorkflow;');
 const source=fs.readFileSync('index.html','utf8');
 for(const name of ['getPdfSafeDateParts','drawSortieBonBesoinPdf']){const start=source.indexOf('      '+(name==='drawSortieBonBesoinPdf'?'async ':'')+'function '+name+'(');await evaluate(source.slice(start,source.indexOf('\n      }',start)+8));}
 const result=await evaluate(`(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)};
 document.body.innerHTML='<div id="app-container"></div>';const container=document.getElementById('app-container');
 const bon={id:'BS-TEST-1',_dbKey:'db1',company_id:'A',date:'2026-09-24T10:00:00Z',bonCreatedAt:'2026-09-24T10:00:00Z',bonValidUntil:'2026-09-25T10:00:00Z',serviceAbbreviation:'B2B',ref:'INSTALLATION',demandeurName:'Technicien <img src=x>',status:'EN ATTENTE GESTIONNAIRE',items:[{op:'OCI',label:'CABLE',qty:5}]};
 window.appData={};window.getSortieItems=b=>b.items;window.getSortieSignatureText=()=>'';window.getSortieTechnicianSignatureText=()=>'';window.getSortieCoordinationSignatureText=()=>'';window.getBonEquipeName=b=>b.demandeurName;window.formatDemandeOps=()=> 'OCI';window.getBonReference=b=>BonReference.format(b);window.addLogoToPdf=async()=>{};window.drawValidatedStamp=()=>{};window.getOperatorMeta=()=>({label:'OCI'});window.getDemandItemOperator=()=> 'OCI';window.ValidatorWorkflow={trace:()=>''};
 const doc=new jspdf.jsPDF();let qrImage;const add=doc.addImage.bind(doc);doc.addImage=(image,...args)=>{qrImage=image;return add(image,...args)};
 await drawSortieBonBesoinPdf(doc,bon);check(qrImage?.startsWith('data:image/png'),'real QR embedded in PDF');
 const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=qrImage});const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const decoded=jsQR(pixels.data,pixels.width,pixels.height);
 check(decoded?.data===BonScanner.code(bon,{}),'QR pixels decode to the correct bon');check(BonScanner.parse(decoded.data,'A')==='BS-TEST-1','QR resolves to request');
 check(doc.output().includes('24/09/2026'),'saved creation date printed');check(doc.output().includes('25/09/2026'),'24h expiry printed');
 const profile={uid:'manager',role:'Gestionnaire',company_id:'A'},calls=[];let response,error=null,issued=0,release;
 const client={rpc:async(name,args)=>{calls.push({name,args});if(release==='wait')return new Promise(r=>{release=r});return error?{error:{message:error}}:{data:response}}};
 BonScanner.setup({profile:()=>profile,client:()=>client});await BonScanner.enter(container);
 const set=state=>{response={state,canIssue:state==='VALIDE',canRequestRenewal:state==='EXPIRE',checkedAt:'2026-09-24T12:00:00Z',expiresAt:bon.bonValidUntil,createdAt:bon.bonCreatedAt,requestKey:'db1',bon,scansToday:[{id:bon.id,heure:'12:00',technicien:'Technicien',state}],deliveredAt:'2026-09-24T11:00:00Z',deliveredBy:'Magasinier'};};
 window.ValidatorWorkflow.issue=async()=>{issued++};
 set('VALIDE');await BonScanner.scan(decoded.data,container);check(container.querySelector('[data-issue]'),'valid bon offers delivery');check(!container.querySelector('img'),'server values escaped');
 set('DEJA_LIVRE');await BonScanner.scan(decoded.data,container);check(!container.querySelector('[data-issue]'),'delivered bon blocked');check(container.textContent.includes('Magasinier'),'delivery actor displayed');check(container.textContent.includes('24/09/2026'),'delivery time displayed');
 set('EXPIRE');await BonScanner.scan(decoded.data,container);check(!container.querySelector('[data-issue]'),'expired bon blocked');check(container.querySelector('[data-renew]'),'renewal action available');
 set('A_VALIDER');await BonScanner.scan(decoded.data,container);check(!container.querySelector('[data-issue]')&&!container.querySelector('[data-renew]'),'initial validation cannot be bypassed');
 error='Connexion interrompue';await BonScanner.scan(decoded.data,container);check(!container.querySelector('[data-issue]'),'offline fails closed');error=null;
 const before=calls.length;await BonScanner.scan('ITC-BON:1:B:BS-TEST-1',container);check(calls.length===before,'foreign company rejected before query');
 set('VALIDE');await BonScanner.scan(decoded.data,container);const button=container.querySelector('[data-issue]');set('DEJA_LIVRE');button.click();await new Promise(r=>setTimeout(r,30));check(issued===0,'late delivery detected by fresh check');
 release='wait';const late=BonScanner.scan(decoded.data,container);await Promise.resolve();await BonScanner.stop();container.innerHTML='SIGNED OUT';release({data:response});await late;check(container.innerHTML==='SIGNED OUT','late result cannot reopen scanner');
 // Exercise the actual validator renewal form with an isolated backend.
 window.ValidatorWorkflow=window.TestValidatorWorkflow;
 const validator={uid:'legacy-validator-id',role:'Validateur',company_id:'A',validatorWorkflowEnabled:true,controlScopes:{OCI:true}},renewalCalls=[];
 let pendingBon={...bon,validatorDecision:{uid:'auth-validator-id',name:'Validateur',at:'2026-09-24T10:10:00Z',approved:true},bonRenewalRequestedAt:'2026-09-26T10:00:00Z',assignedGestionnaireName:'Magasinier'};
 ValidatorWorkflow.setup({profile:()=>validator,uid:()=> 'auth-validator-id',data:()=>({demandes:[pendingBon]}),refresh:async()=>{},client:()=>({rpc:async(name,args)=>{if(name==='workflow_managers')return {data:[]};renewalCalls.push({name,args});pendingBon={...pendingBon,bonRenewalRequestedAt:null,bonValidUntil:'2026-09-27T10:00:00Z'};return {data:pendingBon}}})});
 await ValidatorWorkflow.enter(container);const form=container.querySelector('[data-renewal]');check(form,'attached validator sees renewal queue');
 form.elements.reason.value='Identité du technicien confirmée';const signing=form.onsubmit({preventDefault(){},stopPropagation(){},submitter:{value:'approve'}});
 const signatureForm=document.querySelector('dialog form');signatureForm.elements.signer.value='Validateur';signatureForm.requestSubmit();await signing;
 check(renewalCalls[0]?.name==='confirm_bon_renewal_signed'&&renewalCalls[0].args.approve===true,'renewal action sent to protected RPC');check(renewalCalls[0].args.expected_valid_until===bon.bonValidUntil,'renewal uses loaded expiry for concurrency check');check(!container.querySelector('[data-renewal]'),'confirmed request leaves queue');
 return {message:'PASS: real QR/PDF; scanner statuses, offline and late responses; attached-validator renewal form and confirmation.',pdf:doc.output('datauristring').split(',')[1]};
})()`);
 fs.writeFileSync('.tools/bon-validity-sample.pdf',Buffer.from(result.pdf,'base64'));console.log(result.message);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{ws?.close();chrome?.kill()});
