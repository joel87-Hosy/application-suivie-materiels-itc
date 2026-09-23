const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.indexOf('      function '+name+'(');return html.slice(start,html.indexOf('\n      }',start)+8);}
const context={currentUser:{company_id:'A'},appData:{demandes:[
 {id:1,company_id:'A',workflow:'TECH_BON_SORTIE',op:'ITC-B02',technicianSignatureText:'Tech',coordinationSignatureText:'Coord',validatorDecision:{approved:true,name:'Validator'}},
 {id:2,company_id:'A',workflow:'COORD_DIRECT_BON',op:'ITC-B02',coordinationSignatureText:'Coord'},
 {id:3,company_id:'A',op:'ITC-B01',validatorDecision:{approved:true,name:'Validator'}},
 {id:4,company_id:'A',op:'ITC-B02'},
 {id:5,company_id:'B',op:'ITC-B02',managerSignatureText:'Foreign'}
],sorties:[{id:10,sourceDemandeId:1,company_id:'A',op:'ITC-B02',managerSignatureText:'Manager'},
 {id:11,company_id:'A',op:'ITC-B02',managerSignatureText:'Physical'},
 {id:12,company_id:'A',op:'ITC-B02',sourceDemandeId:'missing',managerSignatureText:'Archived'}]},
 getAllowedOpsForFluxUser:()=>null,getDemandeOps:bon=>bon.ops||[bon.op],normalizeOperatorKey:v=>v,getSortieTimestamp:()=>0};
vm.createContext(context);vm.runInContext(extract('getBonSignatureChain')+'\n'+extract('getSignedBonsHistory'),context);
let rows=context.getSignedBonsHistory();assert.equal(rows.length,5);
assert.equal(rows.filter(r=>r.id===1).length,0,'linked request not duplicated');
assert.equal(context.getBonSignatureChain(rows.find(r=>r.id===10)).length,4,'all chain signatures retained');
assert.equal(rows.find(r=>r.id===10).historySource,'SORTIE');
assert.equal(rows.find(r=>r.id===2).historySource,'DEMANDE');
context.getAllowedOpsForFluxUser=()=>new Set(['ITC-B02']);rows=context.getSignedBonsHistory();assert.equal(rows.length,4);
assert.ok(!rows.some(r=>[3,4,5].includes(r.id)),'unassigned, unsigned and other tenant excluded');
console.log('PASS: full signature chain, direct/physical/legacy bons, linked deduplication, archived request, tenant and stock scope.');
