const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict'),{spawn}=require('child_process');
let chrome,ws;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'itc-affiliations-'));
 chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100&&!port;i++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{await pause(100)}}
 if(!port)throw Error('Chrome unavailable');
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let sequence=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
 const command=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Browser timeout')),15000);pending.set(id,m=>{clearTimeout(timer);if(m.error)reject(Error(m.error.message));else resolve(m.result)});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||'Browser exception');return result.result?.value;};

 await evaluate(fs.readFileSync('assets/account-affiliation.js','utf8'));
 await evaluate(`document.body.innerHTML='<div id="app-container"></div>';window.currentUser={id:3,uid:'coord',role:'Coordinateur',office:'B02',canChooseInitialService:true};window.appData={users:[currentUser]};window.rpcCalls=[];window.ITCSupabaseConfig={client:{rpc:async(name,args)=>{rpcCalls.push({name,args});if(name==='choose_initial_coordinator_service'){currentUser.serviceAbbreviation=args.service_code;currentUser.canChooseInitialService=false;}return {error:null};}}};window.refreshAppDataFromServer=async()=>{};window.renderMonProfil=container=>container.innerHTML=AccountAffiliation.ownSection(currentUser);window.isCurrentCompanySupervisor=()=>true;window.renderCompanyUsersAdmin=()=>{};true`);
 await evaluate(`renderMonProfil(document.getElementById('app-container'));document.querySelector('[name=accountService]').value='B2B';document.querySelector('form').requestSubmit();true`);
 assert.equal(await evaluate(`rpcCalls[0].name`),'choose_initial_coordinator_service');
 assert.equal(await evaluate(`document.querySelector('form')===null`),true,'self-service choice disappears once saved');
 assert.match(await evaluate(`document.body.textContent`),/Bureau 02 · B2B/);
 // Existing account assignment dialog submits the selected office/service.
 await evaluate(`AccountAffiliation.edit(3);document.querySelector('dialog [name=office]').value='B01';document.querySelector('dialog [name=accountService]').value='MAIN';document.querySelector('dialog form').requestSubmit();true`);
 assert.deepEqual(await evaluate(`rpcCalls[1]`),{name:'assign_account_affiliations',args:{target_uid:'coord',office_codes:['B01'],service_codes:['MAIN'],coordinator_ids:[],validator_ids:[]}});
 assert.equal(await evaluate(`document.querySelector('dialog')===null`),true);
 // Role changes enable required fields only for affected accounts.
 await evaluate(`document.getElementById('app-container').innerHTML='<form><select id="cu-user-role"><option>Contrôleur</option><option>Technicien</option><option>Superviseur Terrain</option><option>Validateur</option></select>'+AccountAffiliation.fields({role:'Contrôleur'})+'</form>';window.form=document.querySelector('form');AccountAffiliation.update(form);true`);
 assert.equal(await evaluate(`form.querySelector('[data-affiliation]').hidden`),true);
 await evaluate(`form.querySelector('#cu-user-role').value='Technicien';AccountAffiliation.update(form);true`);
 assert.equal(await evaluate(`form.checkValidity()`),false);
 await evaluate(`form.querySelector('[name=office]').value='B02';form.querySelector('[name=accountService]').value='B2B';true`);
 assert.deepEqual(await evaluate(`AccountAffiliation.values(form,'Technicien')`),{office:'B02',serviceAbbreviation:'B2B',offices:['B02'],services:['B2B'],allowedCoordinatorIds:[],allowedValidatorIds:[]});
 assert.equal(await evaluate(`form.checkValidity()`),true);
 await evaluate(`form.querySelector('#cu-user-role').value='Superviseur Terrain';AccountAffiliation.update(form);true`);
 assert.equal(await evaluate(`form.querySelector('[data-affiliation]').hidden && form.querySelector('[name=office]').disabled`),true);
 assert.deepEqual(await evaluate(`AccountAffiliation.values(form,'Superviseur Terrain')`),{});
 // Several offices/services and selected people survive form serialization.
 await evaluate(`form.querySelector('#cu-user-role').value='Technicien';AccountAffiliation.update(form);for(const o of form.querySelector('[name=office]').options)o.selected=['B01','B02'].includes(o.value);for(const o of form.querySelector('[name=accountService]').options)o.selected=['B2B','MAIN'].includes(o.value);form.querySelector('[name=allowedValidatorIds]').innerHTML='<option value="5" selected>Validator</option>';true`);
 assert.deepEqual(await evaluate(`AccountAffiliation.values(form,'Technicien')`),{office:'B01',offices:['B01','B02'],serviceAbbreviation:'B2B',services:['B2B','MAIN'],allowedCoordinatorIds:[],allowedValidatorIds:['5']});
 await evaluate(fs.readFileSync('assets/request-routing.js','utf8'));
 await evaluate(`document.body.innerHTML='<form><div data-request-routing></div></form>';window.routeForm=document.querySelector('form');window.ITCSupabaseConfig.client.rpc=async()=>({data:{enabled:true,validators:[{uid:'v1',name:'Validator 01',offices:['B01']},{uid:'v2',name:'Validator 02',offices:['B02']}],managers:[{uid:'m1',id:7,name:'Manager 02',scopes:{'ITC-B02':true}}]}});true`);
 assert.match(await evaluate(`(()=>{try{RequestRouting.values(routeForm,[])}catch(e){return e.message}})()`),/chargement/);
 await evaluate(`RequestRouting.mount(routeForm)`);
 assert.equal(await evaluate(`routeForm.checkValidity()`),false);
 await evaluate(`const officeSelect=routeForm.querySelector('[data-routing-office]');officeSelect.value='B01';officeSelect.dispatchEvent(new Event('change'));true`);
 assert.equal(await evaluate(`routeForm.querySelector('[data-routing-validator]').options.length`),2);
 assert.equal(await evaluate(`routeForm.querySelector('[data-routing-validator] option[value=v2]')`),null);
 await evaluate(`routeForm.querySelector('[data-routing-validator]').value='v1';routeForm.querySelector('[data-routing-manager]').value='m1';true`);
 assert.deepEqual(await evaluate(`RequestRouting.values(routeForm,[{op:'ITC-B02'}])`),{requestedValidationOffice:'B01',requestedValidatorUid:'v1',requestedManagerUid:'m1'});
 assert.match(await evaluate(`(()=>{try{RequestRouting.values(routeForm,[{op:'ITC-B01'}])}catch(e){return e.message}})()`),/stocks/);
 await evaluate(`routeForm.querySelector('[data-routing-office]').value='B02';routeForm.querySelector('[data-routing-office]').dispatchEvent(new Event('change'));true`);
 assert.equal(await evaluate(`routeForm.querySelector('[data-routing-validator]').value`),'','changing offices clears the previous validator');
 await evaluate(`window.ITCSupabaseConfig.client.rpc=async()=>({data:{enabled:false}});RequestRouting.mount(routeForm)`);
 assert.deepEqual(await evaluate(`RequestRouting.values(routeForm,[{op:'ITC-B01'}])`),{});
 console.log('PASS: Chrome multiple affiliations, account edit/creation fields, special B01/B02 choices, required validator, manager stock coverage and normal-account fallback.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{ws?.close();chrome?.kill()});
