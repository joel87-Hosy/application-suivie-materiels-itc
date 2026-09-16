const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {SecureStore, collections} = require('../assets/secure-store');
const source = fs.readFileSync('index.html', 'utf8');
function extract(name) {
  const start = source.search(new RegExp('^      (?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n      }', start) + '\n      }'.length;
  return source.slice(start, end);
}
const functions = ['handleRec', 'normalizeOperatorKey', 'getFormTextValue', 'addNotification', 'normalizeAuditFlux', 'buildConsumptionSnapshot', 'sanitizeFirebaseKey', 'getMonthKey', 'getMonthLabel', 'updateRapportHebdo', 'toggleQtyField'];
function setup(op = 'MOOV', stockOp = op, label = 'Câble réseau', qty = '5') {
  const data = Object.fromEntries(collections.map(name => [name, []]));
  data.stock = [{_dbKey:'material', company_id:'A', op:stockOp, label, qty:10, type:'Réseau'}];
  data.users = [{_dbKey:'supervisor', id:42, role:'Superviseur', company_id:'A'}];
  data.materialTypes = ['Réseau'];
  const inputs = Object.fromEntries(Object.entries({'r-op':op,'r-mat':'  câble   réseau  ','r-qty':qty,'r-type':'Autre type','filter-month':String(new Date().getMonth())}).map(([key,value]) => [key,{value}]));
  inputs['hebdo-content'] = {}; inputs['qty-container'] = {style:{}};
  const updates = [], alerts = [], button = {disabled:false}; let nextKey = 0;
  const db = {ref: () => ({push: () => ({key:'new-'+(++nextKey)}), update: async changes => updates.push(changes)})};
  const store = new SecureStore(db, () => {}, () => {});
  store.ready = true; store.uid = 'manager'; store.profile = {role:'Gestionnaire',company_id:'A'};
  store.raw = Object.fromEntries(collections.map(name => [name,Object.fromEntries(data[name].map(({_dbKey,...row})=>[_dbKey,JSON.parse(JSON.stringify(row))]))]));
  store.raw.settings = {materialTypes:['Réseau'], scansDuJour:[],derniereDateScan:null,lastConsumptionArchiveKey:null};
  const context = {appData:data, secureStore:store, currentUser:{id:7,uid:'manager',role:'Gestionnaire'}, document:{getElementById:id=>inputs[id]}, alert:m=>alerts.push(m), isOperatorAllowedForUser:()=>true, getManagedOpsNormalized:()=>[op === 'ITC' ? 'ITC-B02' : op], showSection:()=>{}, updateNotifications:()=>{}, isDateInTargetMonth:()=>true, getSortieTimestamp:()=>Date.now(), generateFluxChart:rows=>context.reportRows=rows, console};
  let pending;
  context.save = () => pending || (pending = Promise.resolve().then(()=>store.save(data)).then(()=>true).finally(()=>{pending=null;}));
  context.getManagedOpsNormalized = () => [op === 'ITC' ? 'ITC-B02' : context.normalizeOperatorKey(op)];
  vm.createContext(context);
  vm.runInContext('let receptionSaving = false;\n'+functions.map(extract).join('\n'), context);
  const submit = () => context.handleRec({preventDefault(){},target:{querySelector:()=>button}});
  return {context,data,inputs,updates,alerts,button,submit};
}
(async () => {
  for (const [op, stored, expected] of [['MOOV','MOOV','MOOV'],['MTN','MTN','MTN'],['OCI-CIC','OCI','OCI'],['ITC-B01','ITC','ITC-B01'],['ITC','ITC-B02','ITC-B02']]) {
    const test = setup(op,stored);
    await test.submit();
    assert.equal(test.data.stock.length,1,op);
    assert.equal(test.data.stock[0].qty,15);
    assert.equal(test.data.stock[0].type,'Réseau');
    assert.equal(test.data.stock[0]._dbKey,'material');
    assert.equal(test.data.notifications.length,1);
    assert.equal(test.data.notifications[0].userId,42);
    assert.equal(test.data.notifications[0].stockOp,expected);
    assert.equal(test.updates.length,1);
    const movements = Object.entries(test.updates[0]).filter(([path])=>path.startsWith('itc_data/stockMovements/'));
    assert.equal(movements.length,1);
    const movement = movements[0][1];
    assert.equal(movement.stockKey,'material');
    assert.equal(movement.before,10); assert.equal(movement.after,15); assert.equal(movement.qty,5);
    assert.equal(movement.type,'in'); assert.equal(movement.actorUid,'manager');
    const snapshot = test.context.buildConsumptionSnapshot(new Date().getMonth(),new Date().getFullYear());
    assert.equal(snapshot.operatorStats[expected].availableTotal,15);
    assert.equal(Object.values(snapshot.operatorStats[expected].entrantsByDesignation)[0],5);
    test.context.updateRapportHebdo();
    assert.equal(test.context.reportRows.length,1);
    assert.equal(test.context.reportRows[0].op,expected);
    assert.equal(test.context.reportRows[0].qty,5);
  }
  for (const qty of ['', '0', '-2', '1.5', 'abc']) {
    const test = setup('MOOV','MOOV','Câble réseau',qty); await test.submit();
    assert.equal(test.data.stock[0].qty,10); assert.equal(test.updates.length,0); assert.equal(test.button.disabled,false);
  }
  for (const variant of ['new','other-stock','other-company']) {
    const test = setup();
    if (variant === 'new') test.inputs['r-mat'].value = 'Pince';
    if (variant === 'other-stock') test.data.stock[0].op = 'MTN';
    if (variant === 'other-company') test.data.stock[0].company_id = 'B';
    await test.submit();
    assert.equal(test.data.stock.length,2); assert.equal(test.data.stock[0].qty,10); assert.equal(test.data.stock[1].qty,5);
  }
  const double = setup(); await Promise.all([double.submit(),double.submit()]);
  assert.equal(double.data.stock[0].qty,15); assert.equal(double.data.notifications.length,1); assert.equal(double.updates.length,1);
  const denied = setup(); denied.context.isOperatorAllowedForUser=()=>false; await denied.submit();
  assert.equal(denied.updates.length,0); assert.equal(denied.data.stock[0].qty,10);
  const field = setup(); field.context.toggleQtyField('ITC-B02'); assert.equal(field.inputs['qty-container'].style.display,'block');
  console.log('PASS: reception merges, company/stock isolation, input validation, double submission, real transport ledger, monthly snapshot and movement report.');
})().catch(error=>{console.error(error);process.exitCode=1;});
