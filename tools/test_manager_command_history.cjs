const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('      function getManagerCommandGroups('),source=html.slice(start,html.indexOf('\n      }',start)+8);
const record=(id,status,extra={})=>({id,status,company_id:'A',assignedGestionnaireUid:'manager',...extra});
const correction={by:'manager',at:'2026-01-01'};
const context={secureStore:{uid:'manager'},currentUser:{id:3,company_id:'A'},getManagedOpsNormalized:()=>['B01'],getDemandeOps:d=>d.op?[d.op]:[],appData:{demandes:[
 record(1,'REFUSEE VALIDATEUR'),record(2,'EN ATTENTE VALIDATEUR',{correctionHistory:[correction]}),
 record(3,'LIVREE',{correctionHistory:[correction]}),record(4,'EN ATTENTE GESTIONNAIRE'),
 record(5,'REFUSEE VALIDATEUR',{assignedGestionnaireUid:'other'}),record(6,'LIVREE',{company_id:'B',correctionHistory:[correction]}),
 record(7,'EN ATTENTE GESTIONNAIRE',{op:'B01',assignedGestionnaireUid:null}),record(8,'EN ATTENTE GESTIONNAIRE',{op:'B02',assignedGestionnaireUid:null})
]}};
vm.createContext(context);vm.runInContext(source,context);const groups=context.getManagerCommandGroups();
assert.deepEqual(Array.from(groups.rejected,d=>d.id),[1]);assert.deepEqual(Array.from(groups.history,d=>d.id),[2,3]);assert.deepEqual(Array.from(groups.pending,d=>d.id),[4,7]);
console.log('PASS: current rejection, resubmitted/delivered history, legacy pending orders and manager/tenant isolation.');
