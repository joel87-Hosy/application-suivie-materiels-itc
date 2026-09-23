const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ControlCore=require('../assets/control-core');
const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n      }',start)+8);}
const row=(label,op,checked,qty)=>({dataset:{label,op},hidden:false,classList:{toggle(name,value){this.owner.hidden=value;}},check:{checked},qty:{value:qty},querySelector(selector){return selector==='.sortie-stock-check'?this.check:this.qty;}});
const rows=[row('CÂBLE OPTIQUE','ITC-B02',true,'3'),row('ONT Nokia','MOOV',false,''),row('Câble cuivre','ITC-B02',false,'')];
rows.forEach(r=>r.classList.owner=r);
const input={value:''},status={textContent:''};
const context={ControlCore,document:{getElementById:id=>id==='sortie-material-search'?input:status,querySelectorAll:()=>rows},getOperatorMeta:op=>({label:op==='ITC-B02'?'Bureau 02':op})};
vm.createContext(context);vm.runInContext(['filterSortieMaterials','getSelectedSortieItemsFromPicker','normalizeOperatorKey','isStockScopedUser','isGestionnaireUser','isTechnicienUser','isOperatorAllowedForUser','canViewStockForUser','getManagedOpsNormalized'].map(extract).join('\n'),context);
input.value='cable 02';context.filterSortieMaterials();assert.deepEqual(rows.map(r=>r.hidden),[false,true,false]);
input.value='NOKIA';context.filterSortieMaterials();assert.deepEqual(rows.map(r=>r.hidden),[true,false,true]);
assert.equal(context.getSelectedSortieItemsFromPicker()[0].qty,3,'hidden checked item remains selected with its quantity');
input.value='absent';context.filterSortieMaterials();assert.ok(rows.every(r=>r.hidden));assert.match(status.textContent,/Aucun matériel/);
input.value='';context.filterSortieMaterials();assert.ok(rows.every(r=>!r.hidden));assert.equal(rows[0].check.checked,true);assert.equal(rows[0].qty.value,'3');
const b02={role:'Gestionnaire',controlScopes:{'ITC-B02':true,'ITC-BOUAKE':true}};
assert.deepEqual(ControlCore.managerStocks(b02),['ITC-B02']);
for(const city of ControlCore.regionalStocks){assert.ok(context.canViewStockForUser(b02,city));assert.equal(context.isOperatorAllowedForUser(b02,city),false);assert.ok(ControlCore.transferDestinations(b02).includes(city));}
const cityManager={role:'Gestionnaire',controlScopes:{'ITC-BOUAKE':true}};
assert.equal(context.canViewStockForUser(cityManager,'ITC-B02'),false);assert.equal(context.isOperatorAllowedForUser(cityManager,'ITC-BOUAKE'),true);
console.log('PASS: accent/case/multiword material search, empty results, preserved hidden selections and quantities, B02 read/transfer distinct from edit permissions.');
