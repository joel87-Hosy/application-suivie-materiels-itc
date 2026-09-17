const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('index.html', 'utf8');
function extract(name) {
  const start = source.search(new RegExp('^      (?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n      }', start) + '\n      }'.length);
}
const receipt = {company_id:'A', op:'MOOV', label:'ONT NOKIA', qty:1000, type:'in', createdAt:'2026-09-17T14:35:59.271Z'};
const sheets = [];
const pdfRows = [];
const context = {
  appData:{stockMovements:[receipt], demandes:[], sorties:[], consumptionArchives:[]},
  secureStore:{profile:{company_id:'A',role:'Gestionnaire'}},
  isFluxEntryAllowedForCurrentUser:entry=>entry.op==='MOOV',
  getAllowedOpsForFluxUser:()=>new Set(['MOOV']),
  normalizeOperatorKey:value=>value,
  buildStockQtyByDesignation:()=>new Map([['ONT NOKIA',1000]]),
  getCurrentStockQtyForDesignation:()=>1000,
  getVisibleStockEntriesForFlux:()=>[{company_id:'A',op:'MOOV',label:'ONT NOKIA',type:'BOX CLIENT',qty:1000}],
  escapeHtml:value=>String(value), renderFluxArchivesHtml:()=>'',
  getSortieItems:row=>row.items||[], console,
  addLogoToPdf:async()=>{},
  window:{jspdf:{jsPDF:class {
    constructor(){this.internal={pageSize:{getHeight:()=>297}};}
    setFontSize(){} text(){} addPage(){} save(){}
    autoTable(table){pdfRows.push(...table.body);}
  }}},
  XLSX:{utils:{book_new:()=>({}),json_to_sheet:rows=>rows,book_append_sheet:(book,rows,name)=>sheets.push({name,rows})},writeFile:()=>{}},
};
vm.createContext(context);
vm.runInContext(['getFluxStockEntries','getSortieTimestamp','getMonthKey','getMonthLabel','sanitizeFirebaseKey','ensureFluxMaterial','renderFluxMateriels','renderFluxMovementDates','renderFluxMaterielDetail','exportFluxMaterielsExcel','exportFluxMaterielDetailExcel','exportFluxMaterielsPDF','exportFluxMaterielDetailPDF'].map(extract).join('\n'),context);
(async()=>{
  const container = {};
  context.renderFluxMateriels(container);
  assert.match(container.innerHTML,/text-green-700">1000</);
  context.renderFluxMaterielDetail(container,'ONT NOKIA');
  assert.match(container.innerHTML,/text-green-700">1000</);
  assert.match(container.innerHTML,/Entrée en stock/);
  assert.match(container.innerHTML,/BOX CLIENT/);
  assert.match(container.innerHTML,/17\/09\/2026/);
  assert.match(container.innerHTML,/Aucune sortie enregistrée/);
  context.appData.sorties=[{op:'MOOV',date:'18/09/2026 10:30:00',ref:'BON-1',items:[{label:'ONT NOKIA',qty:20}]}];
  context.renderFluxMaterielDetail(container,'ONT NOKIA');
  assert.match(container.innerHTML,/18\/09\/2026 10:30:00/);
  assert.match(container.innerHTML,/BON-1/);
  context.appData.sorties=[];
  for(const name of ['exportFluxMaterielsExcel','exportFluxMaterielDetailExcel']) {
    sheets.length=0;await context[name]('ONT NOKIA');
    assert.ok(sheets.some(s=>s.rows.some(r=>r.Type==='ENTREE'&&r['Quantité']===1000)),name);
  }
  for(const name of ['exportFluxMaterielsPDF','exportFluxMaterielDetailPDF']) {
    pdfRows.length=0;await context[name]('ONT NOKIA');
    assert.ok(pdfRows.some(row=>row[0]==='ENTREE'&&row[2]==='1000'),name);
  }
  context.appData.stockMovements.push({...receipt,company_id:'B'}, {...receipt,op:'ITC-B01'}, {...receipt,type:'out'}, {...receipt,type:'return'}, {...receipt,qty:-1});
  assert.equal(context.getFluxStockEntries().length,1,'Only positive, authorized company receipts');
  context.appData.stockMovements.push({...receipt,qty:25,createdAt:'2026-09-18T10:00:00Z'});
  assert.equal(context.getFluxStockEntries().reduce((sum,row)=>sum+row.qty,0),1025,'Successive receipts accumulate');
  const archive={company_id:'A',key:'2026-09',operatorStats:{MOOV:{entrantsByDesignation:{'ONT NOKIA':1025}}}};
  context.appData.consumptionArchives=[archive];
  context.renderFluxMateriels(container);
  assert.match(container.innerHTML,/text-green-700">1025</,'Archived receipts counted once');
  context.renderFluxMaterielDetail(container,'ONT NOKIA');
  assert.match(container.innerHTML,/text-green-700">1025</);
  assert.equal(context.getFluxStockEntries([{...archive,company_id:'B'}]).length,2,'Other company archive cannot hide receipts');
  context.appData.demandes=[{company_id:'A',id:'request',status:'LIVREE'}];
  context.appData.stockMovements=[{...receipt,reference:'request'}];
  assert.equal(context.getFluxStockEntries().length,0,'Delivered request not counted twice');
  context.appData.stockMovements=[receipt];
  context.appData.demandes=[];context.appData.consumptionArchives=[];
  context.buildStockQtyByDesignation=()=>new Map();
  context.renderFluxMateriels(container);
  assert.match(container.innerHTML,/text-green-700">1000</,'Receipt remains visible without stock card');
  console.log('PASS: 1000 ONT NOKIA in list, detail and Excel; successive receipts, permissions, archives and request deduplication.');
})().catch(error=>{console.error(error);process.exitCode=1;});
