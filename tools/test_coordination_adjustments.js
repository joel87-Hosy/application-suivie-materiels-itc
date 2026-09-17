const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('index.html', 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`      function ${name}\\(`));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.indexOf('\n      }', start);
  return source.slice(start, end + 8);
}
const demand = {id:'BS-1',workflow:'TECH_BON_SORTIE',status:'EN ATTENTE COORDINATION',coordinateurId:7,ops:['ITC-B01']};
const rows = [
  {dataset:{label:'Cable',op:'ITC-B01'},querySelector:()=>({value:'4'})},
  {dataset:{label:'Connecteur',op:'ITC-B01'},querySelector:()=>({value:'2'})},
];
const context = vm.createContext({
  secureStore:{profile:{role:'Coordinateur'}}, currentUser:{id:7},
  appData:{stock:[{op:'ITC-B01',label:'Cable',qty:8},{op:'ITC-B01',label:'Connecteur',qty:2}]},
  document:{querySelectorAll:()=>rows},
  normalizeOperatorKey:value=>String(value || '').trim().toUpperCase(),
  getDemandeOps:()=>['ITC-B01'],
  getDemandItemOperator:item=>item.op,
  getOperatorMeta:op=>({label:op}), escapeHtml:value=>String(value).replace(/[<>&"']/g,'_'),
});
for (const name of ['canCurrentUserReviewTechDemande','coordinationItemRow','coordinationStockOptions','getCoordinationEditedItems','sameCoordinationItems']) vm.runInContext(extract(name), context);
assert.equal(context.canCurrentUserReviewTechDemande(demand),true);
assert.equal(context.canCurrentUserReviewTechDemande({...demand,coordinateurId:8}),false);
assert.equal(context.canCurrentUserReviewTechDemande({...demand,status:'EN ATTENTE GESTIONNAIRE'}),false);
assert.deepEqual(JSON.parse(JSON.stringify(context.getCoordinationEditedItems(demand))),[{label:'Cable',op:'ITC-B01',qty:4},{label:'Connecteur',op:'ITC-B01',qty:2}]);
assert.equal(context.sameCoordinationItems([{label:'Cable',op:'ITC-B01',qty:2}],[{label:'Cable',op:'itc-b01',qty:2}]),true);
rows[0].querySelector=()=>({value:'9'});
assert.throws(()=>context.getCoordinationEditedItems(demand),/Stock insuffisant/);
rows.length=0;
assert.throws(()=>context.getCoordinationEditedItems(demand),/Conservez au moins un matériel/);
assert.ok(context.coordinationItemRow({label:'<script>',qty:1,op:'ITC-B01'},demand).includes('coord-demand-qty'));
assert.ok(context.coordinationStockOptions(demand).includes('Cable'));
console.log('PASS: coordinator assignment, item edits, stock limit, empty request rejection and safe editable rows.');
