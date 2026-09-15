// Stock-control permissions are deliberately separate from operational writers.
module.exports = function ({rules, p, role, company, member, admin, listRead, recordRead}) {
  const controller = `${role} === 'Contrôleur'`;
  const supervisor = `${role} === 'Superviseur'`;
  const manager = `${role} === 'Gestionnaire'`;
  const normalize = snap => `(${snap}.child('op').val() === 'ITC' ? 'ITC-B01' : (${snap}.child('op').isString() ? ${snap}.child('op').val() : ''))`;
  for (const name of ['stock', 'stockMovements', 'sorties', 'demandes', 'retours', 'notifications', 'techDemandes', 'consumptionArchives', 'platformAuditLogs']) {
    const collection = rules.itc_data[name];
    const scoped = ['stock', 'stockMovements', 'sorties', 'demandes', 'retours'].includes(name);
    const permittedQuery = `query.equalTo != null && query.equalTo.beginsWith(${company} + '|')`;
    collection['.read'] = scoped ? `${listRead} || (${member} && ${controller} && query.orderByChild === 'scope_key' && (${permittedQuery}))` : `${admin} || (${role} !== 'Contrôleur' && (${listRead}))`;
    collection.$key['.read'] = scoped ? recordRead : `${admin} || (${role} !== 'Contrôleur' && (${recordRead}))`;
    if (scoped) {
      collection['.indexOn'].push('scope_key');
      collection.$key.scope_key = {'.validate': `newData.val() === newData.parent().child('company_id').val() + '|' + (${normalize('newData.parent()')} == null ? '' : ${normalize('newData.parent()')})`};
    }
  }
  const base = `root.child('stock_control').child(${company}).child($op)`;
  const access = `${member} && ${company} === $company && (${supervisor} || ${controller} || (${manager} && ${p}.child('controlScopes').child($op).val() === true))`;
  const controlWrite = `(${access}) && ${controller}`;
  const supWrite = `(${access}) && ${supervisor}`;
  const managedWrite = `(${access}) && ${manager}`;
  const own = "data.child('createdBy').val() === auth.uid";
  const stamp = "newData.child('createdBy').val() === auth.uid && newData.child('createdAt').isString()";
  const immutable = "newData.child('createdBy').val() === data.child('createdBy').val() && newData.child('createdAt').val() === data.child('createdAt').val()";
  const opRules = {'.read': access};
  rules.stock_control = {'$company': {'$op': opRules}};
  // No grant on a parent: child writes cannot overwrite other people's responses.
  opRules.events = {'$id': {'.write': `(${access}) && !data.exists() && newData.exists()`, '.validate': "newData.hasChildren(['actorUid','at','message']) && newData.child('actorUid').val() === auth.uid && newData.child('message').isString() && newData.child('message').val().length <= 2000"}};
  opRules.preferences = {'$uid': {'.write': `(${access}) && auth.uid === $uid`, '.validate': "newData.hasChildren(['lastSeen']) && newData.child('lastSeen').isString()"}};
  for (const kind of ['missions', 'audits', 'anomalies', 'actions', 'checks']) {
    const closed = "data.child('status').val() === 'closed'";
    const preserveResponses = ['response', 'decision'].flatMap(field => ['text','by','at'].map(key => `newData.child('${field}/${key}').val() === data.child('${field}/${key}').val()`)).join(' && ');
    opRules[kind] = {'$id': {
      '.write': `(${controlWrite}) && newData.exists() && ((!data.exists() && ${stamp} && newData.child('status').val() === 'open' && !newData.child('response').exists() && !newData.child('decision').exists()) || (${own} && !(${closed}) && ${immutable} && ${preserveResponses}))`,
      '.validate': "newData.hasChildren(['title','status','createdBy','createdAt']) && newData.child('title').isString() && newData.child('title').val().length > 0 && newData.child('title').val().length <= 300 && newData.child('status').val().matches(/^(open|planned|progress|justification|verify|conform|anomaly|closed)$/)",
      response: {'.write': `(${managedWrite}) && data.parent().exists() && data.parent().child('status').val() !== 'closed'`, '.validate': "newData.hasChildren(['text','by','at']) && newData.child('by').val() === auth.uid && newData.child('text').isString() && newData.child('text').val().length <= 5000"},
      decision: {'.write': `(${supWrite}) && data.parent().exists() && data.parent().child('status').val() !== 'closed' && data.parent().child('createdBy').val() !== auth.uid && !data.exists()`, '.validate': "newData.hasChildren(['text','by','at']) && newData.child('by').val() === auth.uid"},
    }};
    opRules[kind].$id['.validate'] += " && (newData.child('status').val() !== 'closed' || (newData.child('description').isString() && newData.child('description').val().length > 0 && newData.child('evidence').isString() && newData.child('evidence').val().length > 0))";
    if (kind === 'actions') opRules[kind].$id['.validate'] += " && (newData.child('status').val() !== 'closed' || newData.child('response').exists())";
    if (kind === 'checks') opRules[kind].$id['.validate'] += " && (newData.child('source').val() !== 'transfer' || (newData.child('sentQty').isNumber() && newData.child('sentQty').val() >= 0 && newData.child('toStock').isString() && newData.child('toStock').val() !== $op && (!newData.child('receivedQty').exists() || (newData.child('receivedQty').isNumber() && newData.child('receivedQty').val() >= 0)) && (newData.child('status').val() !== 'conform' || newData.child('receivedQty').val() === newData.child('sentQty').val())))";
    if (kind === 'audits') opRules[kind].$id['.validate'] += " && (newData.child('status').val() !== 'closed' || (" + Array.from({length:8},(_,i) => `newData.child('checklist/${i}/result').isString() && newData.child('checklist/${i}/result').val() !== 'Non vérifié'`).join(' && ') + '))';
  }
  const inv = `${base}.child('inventories').child($id)`;
  opRules.inventories = {'$id': {
    '.write': `(${controlWrite}) && !data.exists() && newData.exists() && ${stamp} && newData.child('status').val() === 'draft' && !newData.child('lines').exists() && !newData.child('decision').exists() && !newData.child('managerCounts').exists() && !newData.child('managerResponse').exists()`,
    '.validate': "newData.hasChildren(['title','status','createdBy','createdAt']) && newData.child('title').isString() && newData.child('title').val().length > 0",
    status: {
      '.write': `newData.exists() && (((${controlWrite}) && data.parent().child('createdBy').val() === auth.uid && ((data.val() === 'draft' && newData.val() === 'counting' && ${base}.child('lock').val() === $id) || (data.val() === 'counting' && newData.val() === 'review') || (data.val() === 'review' && newData.val() === 'counting') || ((data.val() === 'draft' || data.val() === 'counting' || data.val() === 'review') && newData.val() === 'cancelled'))) || ((${supWrite}) && data.parent().child('createdBy').val() !== auth.uid && ((data.val() === 'review' && (newData.val() === 'approved' || newData.val() === 'counting')) || (data.val() === 'approved' && newData.val() === 'closed') || ((data.val() === 'draft' || data.val() === 'counting' || data.val() === 'review') && newData.val() === 'cancelled'))))`,
      '.validate': "newData.isString()",
    },
    referenceAt: {'.write': `(${controlWrite}) && ${inv}.child('createdBy').val() === auth.uid && ${inv}.child('status').val() === 'draft' && ${base}.child('lock').val() === $id`, '.validate': 'newData.isString()'},
    lines: {'.write': `(${controlWrite}) && !data.exists() && newData.exists() && ${inv}.child('createdBy').val() === auth.uid && ${inv}.child('status').val() === 'draft' && ${base}.child('lock').val() === $id`,
      '$stockKey': {'.validate': "newData.hasChildren(['label','theoretical']) && newData.child('theoretical').isNumber() && newData.child('theoretical').val() >= 0 && (!data.exists() || newData.child('theoretical').val() === data.child('theoretical').val()) && (!newData.child('counted').exists() || (newData.child('counted').isNumber() && newData.child('counted').val() >= 0))",
        counted: {'.write': `(${controlWrite}) && ${inv}.child('createdBy').val() === auth.uid && ${inv}.child('status').val() === 'counting' && data.parent().exists() && newData.isNumber() && newData.val() >= 0`},
        note: {'.write': `(${controlWrite}) && ${inv}.child('createdBy').val() === auth.uid && ${inv}.child('status').val() === 'counting' && data.parent().exists() && newData.isString()`},
      },
    },
    managerCounts: {'$stockKey': {'.write': `(${managedWrite}) && ${inv}.child('status').val() === 'counting' && ${inv}.child('lines').child($stockKey).exists()`, '.validate': "newData.hasChildren(['qty','by','at']) && newData.child('qty').isNumber() && newData.child('qty').val() >= 0 && newData.child('by').val() === auth.uid"}},
    managerResponse: {'.write': `(${managedWrite}) && (${inv}.child('status').val() === 'counting' || ${inv}.child('status').val() === 'review')`, '.validate': "newData.hasChildren(['text','by','at']) && newData.child('by').val() === auth.uid"},
    decision: {'.write': `(${supWrite}) && ${inv}.child('createdBy').val() !== auth.uid && ${inv}.child('status').val() === 'review'`, '.validate': "newData.hasChildren(['text','by','at']) && newData.child('by').val() === auth.uid"},
  }};
  opRules.inventories.$id.lines.$stockKey['.validate'] += ` && (data.exists() || (root.child('itc_data/stock').child($stockKey).child('company_id').val() === $company && ${normalize("root.child('itc_data/stock').child($stockKey)")} === $op && root.child('itc_data/stock').child($stockKey).child('qty').val() === newData.child('theoretical').val()))`;
  opRules.inventories.$id.status['.validate'] += " && (newData.val() !== 'approved' || (newData.parent().child('decision/by').val() === auth.uid && newData.parent().child('decision/text').isString() && newData.parent().child('decision/text').val().length > 0 && newData.parent().child('managerResponse').exists() && newData.parent().child('lines').hasChildren() && newData.parent().child('managerCounts').hasChildren()))";
  for (const kind of ['missions','audits','anomalies','actions','checks','inventories']) {
    const dossier = `${base}.child('${kind}').child($id)`;
    opRules[kind].$id.attachments = {'$file': {
      '.write': `(${controlWrite}) && ${dossier}.child('createdBy').val() === auth.uid && (${dossier}.child('status').val() === 'draft' || ${dossier}.child('status').val() === 'counting') && !data.exists() && newData.exists()`,
      '.validate': "newData.hasChildren(['name','type','size','data','by','at']) && newData.child('by').val() === auth.uid && newData.child('name').isString() && newData.child('name').val().length <= 254 && newData.child('size').isNumber() && newData.child('size').val() <= 262144 && newData.child('data').isString() && newData.child('data').val().length <= 350000 && (newData.child('type').val() === 'image/png' || newData.child('type').val() === 'image/jpeg' || newData.child('type').val() === 'application/pdf') && (!data.exists() || newData.child('data').val() === data.child('data').val())",
    }};
    // File validation must not require the current actor to be the uploader when
    // a manager responds or a supervisor approves the containing dossier.
    opRules[kind].$id.attachments.$file['.validate'] = opRules[kind].$id.attachments.$file['.validate'].replace("newData.child('by').val() === auth.uid", "((!data.exists() && newData.child('by').val() === auth.uid) || (data.exists() && newData.child('by').val() === data.child('by').val()))");
  }
  opRules.lock = {
    '.write': `(${access}) && ((!data.exists() && newData.isString() && ${controller} && ${base}.child('inventories').child(newData.val()).child('createdBy').val() === auth.uid && ${base}.child('inventories').child(newData.val()).child('status').val() === 'draft') || (data.exists() && !newData.exists() && (${base}.child('inventories').child(data.val()).child('status').val() === 'closed' || ${base}.child('inventories').child(data.val()).child('status').val() === 'cancelled')))`,
  };
  const row = rules.itc_data.stock.$key;
  const lock = snap => `root.child('stock_control').child(${snap}.child('company_id').isString() ? ${snap}.child('company_id').val() : '_none').child(${snap}.child('op').isString() ? ${normalize(snap)} : '_none').child('lock')`;
  const lockedId = `${lock('data')}.val()`;
  const approved = `root.child('stock_control').child(${company}).child(${normalize('data')}).child('inventories').child(${lockedId})`;
  const line = `${approved}.child('lines').child($key)`;
  const safeAdjustment = `${supervisor} && data.exists() && newData.exists() && newData.child('op').val() === data.child('op').val() && ${approved}.child('status').val() === 'approved' && ${approved}.child('createdBy').val() !== auth.uid && ${line}.child('counted').isNumber() && data.child('qty').val() === ${line}.child('theoretical').val() && newData.child('qty').val() === ${line}.child('counted').val() && !data.child('controlAdjustments').child(${lockedId}).exists() && newData.child('controlAdjustments').child(${lockedId}).child('before').val() === data.child('qty').val() && newData.child('controlAdjustments').child(${lockedId}).child('after').val() === newData.child('qty').val()`;
  // Existing stock writers retain their rights outside a frozen inventory.
  row['.write'] = `(${row['.write']}) && (newData.exists() || !data.child('controlAdjustments').exists()) && ((!${lock('data')}.exists() && !${lock('newData')}.exists()) || (${safeAdjustment}))`;
  row['.validate'] += " && (!data.child('controlAdjustments').exists() || newData.child('controlAdjustments').exists())";
  row.controlAdjustments = {'$inventoryId': {'.validate': `(data.exists() && newData.child('before').val() === data.child('before').val() && newData.child('after').val() === data.child('after').val() && newData.child('delta').val() === data.child('delta').val()) || (!data.exists() && ${supervisor} && $inventoryId === ${lockedId} && newData.child('delta').val() === newData.child('after').val() - newData.child('before').val())`}};
  // Grant edits at field level so deleting an adjustment cannot bypass validation.
  const stockPermission = row['.write'];
  const atParent = (expression, levels) => expression.replace(/\bnewData\b/g, '__NEW__').replace(/\bdata\b/g, 'data' + '.parent()'.repeat(levels)).replace(/__NEW__/g, 'newData' + '.parent()'.repeat(levels));
  row['.write'] = `(${stockPermission}) && (!data.exists() || !newData.exists() || (${safeAdjustment}))`;
  row.$field = {'.write': `(${atParent(stockPermission,1)}) && $field !== 'controlAdjustments'`};
  row.scope_key['.write'] = atParent(stockPermission,1);
  row.controlAdjustments.$inventoryId['.write'] = `(${atParent(stockPermission,2)}) && newData.exists() && ((!data.exists() && (${atParent(safeAdjustment,2)})) || (data.exists() && newData.child('before').val() === data.child('before').val() && newData.child('after').val() === data.child('after').val() && newData.child('delta').val() === data.child('delta').val()))`;
  row.controlAdjustments.$inventoryId['.validate'] = `(data.exists() && newData.child('before').val() === data.child('before').val() && newData.child('after').val() === data.child('after').val() && newData.child('delta').val() === data.child('delta').val()) || (!data.exists() && ${supervisor} && $inventoryId === ${atParent(lockedId,2)} && newData.child('delta').val() === newData.child('after').val() - newData.child('before').val())`;
};
