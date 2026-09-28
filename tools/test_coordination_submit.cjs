const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('      async function coordSignAndSendDemande('),html.indexOf('      function preparerCmd('));
(async()=>{
 for(const enabled of [true,false]){
  const request={id:'BON-TEST',demandeurOriginalId:999,items:[{op:'ITC-B01',label:'Cable',qty:1}]};
  const notifications=[],alerts=[];let saved=false,navigated=false;
  const context={appData:{demandes:[request]},currentUser:{id:3,name:'Coordinateur'},secureStore:{generation:1},
   document:{getElementById:()=>({value:'7'})},canCurrentUserReviewTechDemande:()=>true,
   getFormTextValue:()=> 'Coordinateur',getCoordinationEditedItems:()=>request.items,
   normalizeOperatorKey:x=>x,getDemandItemOperator:x=>x.op,sameCoordinationItems:()=>true,
   gestionnaireNameById:()=> 'Gestionnaire',getBonReference:x=>x.id,
   window:{ValidatorWorkflow:{enabled:()=>enabled},RequestRouting:{values:()=>({})},BonSignatures:{capture:async()=>({name:'Coordinateur',image:'signed'})}},
   addNotification:(id,message)=>notifications.push({id,message}),alert:x=>alerts.push(x),
   save:async()=>{if(enabled&&notifications.length)throw Error('Destinataire non autorisé.');saved=true;return true;},
   showSection:()=>{navigated=true;}};
  vm.createContext(context);vm.runInContext(source,context);
  await context.coordSignAndSendDemande(request.id);
  assert.ok(saved&&navigated,'signature enregistrée et navigation réussie');
  assert.equal(request.bonSignatures.coordination.name,'Coordinateur');
  assert.equal(notifications.length,enabled?0:2,'le circuit serveur ne soumet aucun destinataire client');
  assert.match(alerts[0],enabled?/VALIDATEUR/:/GESTIONNAIRE/);
 }
 console.log('PASS coordination submit: server routing tolerates obsolete requester IDs; legacy notifications preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
