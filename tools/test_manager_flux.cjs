const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/manager-flux.js','utf8'),ctx);
const api=ctx.ManagerFlux,profile={id:7,uid:'legacy',company_id:'A',controlScopes:{'ITC-B02':true,MOOV:true}};
const date='2026-09-24T10:00:00Z';
const receipt={company_id:'A',op:'ITC-B02',label:'BOX',type:'in',qty:40,createdAt:date,actorUid:'u'};
const output={id:'s1',company_id:'A',validatedById:7,status:'LIVREE',sourceDemandeId:'d1',validatedAt:date,ref:'BON-1',op:'ITC-B01',items:[{op:'ITC-B02',label:'BOX',qty:3},{op:'MOOV',label:'BOX',qty:2},{op:'ITC-B01',label:'BOX',qty:100}]};
const data={stock:[{company_id:'A',op:'ITC-B02',label:'BOX',qty:819},{company_id:'B',op:'ITC-B02',label:'BOX',qty:900}],stockMovements:[{...receipt,id:'r1'},{...receipt,id:'r2',qty:20},{...receipt,id:'transfer',movementKind:'TRANSFERT_ENTREE'},{...receipt,id:'other',actorUid:'someone'},{...receipt,id:'foreign',company_id:'B'}],sorties:[output],demandes:[{...output,id:'d1',sortieId:'s1'},{...output,id:'pending',status:'EN ATTENTE GESTIONNAIRE'},{...output,id:'legacy',sortieId:undefined}]};
const rows=api.collect(data,profile,'u',v=>v,Date.parse),box=rows[0];
assert.equal(box.stock,819);assert.equal(box.movements.filter(v=>v.type==='ENTREE').length,2);
assert.equal(box.movements.filter(v=>v.type==='ENTREE').reduce((n,v)=>n+v.qty,0),60);
assert.equal(new Set(box.movements.filter(v=>v.type==='SORTIE').map(v=>v.operation)).size,2,'one output per bon even across two stocks; linked request not duplicated');
assert.equal(box.movements.filter(v=>v.type==='SORTIE').reduce((n,v)=>n+v.qty,0),10);
for(const [period,anchor,start,end] of [['day','2026-09-24','2026-09-24','2026-09-25'],['week','2026-09-27','2026-09-21','2026-09-28'],['month','2024-02-29','2024-02-01','2024-03-01'],['year','2026-09-24','2026-01-01','2027-01-01']]){
 const range=api.bounds(period,anchor);assert.equal(range.start,+new Date(start+'T00:00:00'));assert.equal(range.end,+new Date(end+'T00:00:00'));
}
const elements={};const container={querySelector(selector){return elements[selector]||={addEventListener(){}};},querySelectorAll(){return [];}};
api.setup({data:()=>data,profile:()=>profile,uid:()=> 'u',op:v=>v,timestamp:Date.parse});
api.render(container,'BOX');elements['[data-date]'].onchange({target:{value:'2026-09-24'}});
assert.match(container.innerHTML,/Total entrées/);assert.match(container.innerHTML,/text-2xl">2<\/strong>/);assert.match(container.innerHTML,/Stock déduit/);assert.match(container.innerHTML,/Stock destinataire/);assert.match(container.innerHTML,/BON-1/);assert.doesNotMatch(container.innerHTML,/Solde/);
elements['[data-date]'].onchange({target:{value:'2025-09-24'}});assert.match(container.innerHTML,/text-2xl">0<\/strong>/);assert.match(container.innerHTML,/>819<\/strong>/,'present stock unaffected by past period');
console.log('PASS: manager flux operation counts, receipt/issue sources, per-item scopes, tenant/actor isolation, no double counting, period boundaries and current stock.');
