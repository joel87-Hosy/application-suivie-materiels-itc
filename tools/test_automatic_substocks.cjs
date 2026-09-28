const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
 let modal,refreshes=0;
 const status={textContent:''},cancel={};let inputs=[];
 const context={window:{ControlCore:require('../assets/control-core')},document:{body:{append(){}},createElement(){
  modal={innerHTML:'',showModal(){},remove(){},close(){this.onclose();},querySelector:s=>s==='[data-cancel]'?cancel:status,querySelectorAll:()=>inputs};return modal;
 }}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('assets/stock-substocks.js','utf8'),context);
 const mod=context.window.StockSubstocks;
 let stock=[{company_id:'A',op:'MOOV',label:'Cable',qty:30,subStocks:{production:10,deploiement:10,maintenance:10}}];
 mod.setup({profile:()=>({role:'Gestionnaire',company_id:'A',controlScopes:{'ITC-B02':true,MOOV:true}}),data:()=>({stock}),refresh:async()=>{refreshes++;}});
 const request=service=>({op:'MOOV',serviceAbbreviation:service,items:[{label:'Cable',qty:8}]});
 for(const [service,bucket] of [['B2B','production'],['DEP','deploiement'],['MAIN','maintenance']]){
  const selected=await mod.chooseIssue(request(service));
  assert.equal(selected[0].substock,bucket);assert.equal(selected[0].qty,8);assert.equal(modal,undefined,'aucune fenêtre si quantité suffisante');
 }
 const repeated=request('B2B');repeated.items.push({label:' cable ',qty:5});
 const pending=mod.chooseIssue(repeated);await new Promise(setImmediate);
 assert.match(modal.innerHTML,/Sous-stock du service insuffisant/);assert.match(modal.innerHTML,/value="10"/);
 inputs=[{value:'10',dataset:{bucket:'production'}},{value:'11',dataset:{bucket:'maintenance'}}];
 modal.onsubmit({preventDefault(){}});assert.match(status.textContent,/disponible/);
 inputs[1].value='3';modal.onsubmit({preventDefault(){}});
 const selected=await pending;assert.equal(selected.length,2);assert.equal(selected.reduce((s,i)=>s+i.qty,0),13);
 assert.equal(selected[1].substock,'maintenance');
 stock.push({company_id:'A',op:'MOOV',label:'Box',qty:50,subStocks:{production:50}});
 const mixed=request('B2B');mixed.items=[{label:'Cable',qty:13},{label:'Box',qty:20}];
 const mixedPending=mod.chooseIssue(mixed);await new Promise(setImmediate);assert.ok(!modal.innerHTML.includes('Box'));
 inputs=[{value:'0',dataset:{bucket:'production'}},{value:'10',dataset:{bucket:'maintenance'}},{value:'3',dataset:{bucket:'deploiement'}}];
 modal.onsubmit({preventDefault(){}});const combined=await mixedPending;
 assert.equal(combined.find(i=>i.label==='Box').qty,20);assert.equal(combined.find(i=>i.label==='Box').substock,'production');
 const cancelled=mod.chooseIssue(repeated);await new Promise(setImmediate);cancel.onclick();assert.equal(await cancelled,null);
 await assert.rejects(mod.chooseIssue({...request('B2B'),items:[{label:'Cable',qty:31}]}),/Stock total insuffisant/);
 assert.ok(refreshes>=7);
 console.log('PASS automatic substocks: service mapping, refresh, grouped shortages, alternate stock, mixed automatic/manual, bounds, cancellation and insufficient total');
})().catch(e=>{console.error(e);process.exitCode=1;});
