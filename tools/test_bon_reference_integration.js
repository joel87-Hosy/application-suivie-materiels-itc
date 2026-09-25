const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BonReference = require('../assets/bon-reference');
const source = fs.readFileSync('index.html', 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`      (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n      }', start) + 8);
}
const demande = {id:'BS-1234',_dbKey:'d1',company_id:'A',workflow:'TECH_BON_SORTIE',status:'LIVREE',demandeurOriginalId:1,demandeurName:'Equipe',motif:'Chantier Abobo',sortieId:'SORTIE-12345'};
const sortie = {id:'SORTIE-12345',_dbKey:'s1',company_id:'A',sourceDemandeId:demande.id,date:'17/09/2026',ref:demande.motif,items:[{label:'Cable',qty:2}],managerSignatureText:'Signature originale'};
const calls = [], alerts = [];
const ctx = vm.createContext({BonReference,ControlCore:require('../assets/control-core'),console,appData:{demandes:[demande],sorties:[sortie]},currentUser:{id:1,company_id:'A'},secureStore:{uid:'manager',profile:{role:'Gestionnaire',company_id:'A',controlScopes:{'ITC-B01':true}}},
  getDemandeOps:()=>['ITC-B01'],getAllowedOpsForFluxUser:()=>new Set(['ITC-B01']),
  canCurrentUserManageSortie:()=>true,escapeHtml:s=>String(s ?? ''),alert:s=>alerts.push(s),showSection:()=>{},currentSectionId:'bons-signes',
  supabaseBackend:{rpc:async(name,args)=>{calls.push({name,args});return {error:null};}},refreshAppDataFromServer:async()=>{},
  window:{ValidatorWorkflow:{trace:()=>''},BonScanner:{pdf:async(doc,record,data,y)=>y+34}},
  isBonSignedByCurrentUser:()=>true,getBonSignatureRoleForCurrentUser:()=>'Gestionnaire',getSortieTimestamp:()=>0,formatDemandeOps:()=>'ITC-B01',getSortieItems:s=>s.items||[],addLogoToPdf:async()=>{},getDemandItemOperator:()=> 'ITC-B01',getOperatorMeta:()=>({label:'ITC-B01'})});
for(const name of ['getBonReference','bonServiceField','canAssignBonService','bonServiceEditor','saveBonService','getBonSignatureChain','canViewSignedBon','getSignedBonsHistory','renderSignedBonsHistory','renderTechMesDemandes','getPdfSafeDateParts','formatAutomaticSignature','getSortieSignatureText','getSortieTechnicianSignatureText','getBonEquipeName','getSortieCoordinationSignatureText','drawValidatedStamp','drawSortieBonBesoinPdf']) vm.runInContext(extract(name),ctx);
async function main(){
  const select={value:'DEP'};
  await ctx.saveBonService('sorties','s1',select);
  assert.equal(calls.length,1);
  // Le serveur résout lui-même le bon lié : le client n'envoie que le bon visé.
  // JSON : les objets créés dans le contexte vm n'ont pas les mêmes prototypes.
  assert.equal(JSON.stringify(calls[0]),JSON.stringify({name:'assign_bon_service',args:{bon_collection:'sorties',bon_key:'s1',service_code:'DEP'}}));
  assert.equal(sortie.serviceAbbreviation,'DEP');
  assert.equal(sortie.managerSignatureText,'Signature originale');
  assert.equal(sortie.items[0].qty,2);
  assert.equal(ctx.getBonReference(demande),ctx.getBonReference(sortie));
  for(const render of ['renderSignedBonsHistory','renderTechMesDemandes']) {
    const container={};ctx[render](container);
    assert.ok(container.innerHTML.includes(ctx.getBonReference(sortie)),render);
    const target=render==='renderSignedBonsHistory'?"exportSortiePDF('SORTIE-12345')":"downloadPDF('BS-1234')";
    assert.ok(container.innerHTML.includes(target),'Existing download target');
  }
  ctx.secureStore.profile.company_id='B';
  await ctx.saveBonService('sorties','s1',{value:'MAIN'});
  ctx.secureStore.profile.company_id='A';ctx.secureStore.profile.role='Technicien';
  await ctx.saveBonService('sorties','s1',{value:'MAIN'});
  assert.equal(calls.length,1,'Unauthorized edits rejected');
  ctx.secureStore.profile.role='Gestionnaire';
  ctx.supabaseBackend.rpc=async()=>({error:new Error('offline')});
  const failedSelect={value:'MAIN'};
  await ctx.saveBonService('sorties','s1',failedSelect);
  assert.equal(sortie.serviceAbbreviation,'DEP');assert.equal(failedSelect.value,'DEP');assert.equal(failedSelect.disabled,false);
  // Use the same locally cached jsPDF and AutoTable bundles as the application.
  const {jsPDF}=require('../.tools/report-libs/jspdf.js');
  require('../.tools/report-libs/autotable.js').applyPlugin(jsPDF);
  const doc=new jsPDF(),texts=[];const text=doc.text.bind(doc);
  doc.text=(s,...args)=>{texts.push(Array.isArray(s)?s.join(''):s);return text(s,...args);};
  await ctx.drawSortieBonBesoinPdf(doc,sortie);
  assert.ok(texts.includes('Code : '+ctx.getBonReference(sortie)));
  assert.ok(texts.includes('Service/Departement : DEP'));
  assert.ok(texts.some(s=>s.includes('Signature originale')));
  assert.ok(doc.output().startsWith('%PDF'));
  console.log('PASS: linked metadata update, access checks, failed write recovery, both tab renderers and real PDF generation.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
