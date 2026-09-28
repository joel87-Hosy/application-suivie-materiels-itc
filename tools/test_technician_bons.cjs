const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('      async function loadTechMesDemandes('),html.indexOf('      function getBonSignatureChain('));
(async()=>{
 let records=[],reads=0;
 const container={innerHTML:''};
 const context={currentUser:{id:42,uid:'legacy-tech',company_id:'A'},currentSectionId:'tech-mes-demandes',pendingSave:null,
  appData:{demandes:[]},secureStore:{generation:1,uid:'auth-tech',read:async()=>{reads++;},value:()=>({demandes:records})},
  normalizeAppData:x=>x,markNotificationsAsRead:async()=>{},escapeHtml:x=>String(x),getBonReference:x=>x.id,console};
 vm.createContext(context);vm.runInContext(source,context);
 const owns=context.isCurrentTechnicianBon;
 assert.ok(owns({demandeurOriginalId:'42',company_id:'A'}));
 assert.ok(owns({technicienUid:'auth-tech',demandeurOriginalId:99}));
 assert.ok(owns({technicienUid:'legacy-tech'}));
 assert.equal(owns({technicienUid:'other',demandeurOriginalId:42}),false);
 assert.equal(owns({demandeurOriginalId:42,company_id:'B'}),false);
 assert.equal(owns({}),false);
 records=['PRET','PREPAREE','LIVREE','EN ATTENTE VALIDATEUR'].map((status,i)=>({id:'BON-'+i,demandeurOriginalId:'42',company_id:'A',status}));
 records.push({id:'OTHER',demandeurOriginalId:43,status:'PRET'});
 await context.loadTechMesDemandes(container);
 assert.equal(reads,1);
 assert.match(container.innerHTML,/PRÊTS: 2/);assert.match(container.innerHTML,/LIVRÉS: 1/);assert.match(container.innerHTML,/EN ATTENTE: 1/);
 assert.match(container.innerHTML,/downloadPDF\('BON-0'\)/);assert.ok(!container.innerHTML.includes('OTHER'));
 const cases=[
  [{statut:'prêt'},'ready'],[{status:' PRÉPARÉE '},'ready'],[{statut:'Livré'},'delivered'],
  [{status:'EN_ATTENTE_VALIDATEUR'},'pending'],[{status:'EN ATTENTE COORDINATION'},'pending'],
  [{status:'EN ATTENTE GESTIONNAIRE'},'pending'],[{status:'APPROUVEE'},'pending'],
  [{status:'REFUSEE VALIDATEUR',validatorDecision:{approved:false,reason:'Quantité à corriger'}},'pending'],
  [{status:'Ancien statut'},'pending'],[{},'pending']
 ];
 for(const [bon,stage] of cases)assert.equal(context.technicianBonStage(bon),stage);
 records=cases.map(([bon],i)=>({...bon,id:'HISTORY-'+i,demandeurOriginalId:42}));
 await context.loadTechMesDemandes(container);
 assert.match(container.innerHTML,/PRÊTS: 2/);assert.match(container.innerHTML,/LIVRÉS: 1/);assert.match(container.innerHTML,/EN ATTENTE: 7/);
 for(const bon of records)assert.ok(container.innerHTML.includes("downloadPDF('"+bon.id+"')"),'chaque bon reste visible');
 assert.match(container.innerHTML,/Quantité à corriger/);
 context.secureStore.read=async()=>{context.currentSectionId='cockpit';};container.innerHTML='';
 await context.loadTechMesDemandes(container);assert.ok(!container.innerHTML.includes('downloadPDF'));
 console.log('PASS technician bons: fresh data, identity and tenant isolation, ready/delivered/pending counts, PDF access and navigation guard');
})().catch(error=>{console.error(error);process.exitCode=1;});
