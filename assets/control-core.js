/* Shared pure helpers for stock control, provisioning and security indexing. */
(function (global) {
  const scopedCollections = ['stock', 'sorties', 'demandes', 'retours', 'stockMovements'];
  function operator(value) {
    const v = String(value || '').trim().toUpperCase();
    if (!v) return '';
    if (v === 'ITC') return 'ITC-B01';
    return v;
  }
  function scopes(value) {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : Object.entries(value || {}).flatMap(([k,v]) => v === true ? [k] : typeof v === 'string' ? [v] : []);
    return [...new Set(values.map(operator).filter(v => v && !/[.#$\[\]\/|]/.test(v)))];
  }
  function scopeMap(value) { return Object.fromEntries(scopes(value).map(op => [op, true])); }
  function scopeKeys(company, value) { return Object.fromEntries(scopes(value).map(op => [scopeKey(company,op), true])); }
  function scopeKey(company, op) { return company + '|' + operator(op); }
  function quantity(value) {
    if (value === '' || value === null || value === undefined) throw new Error('Saisissez une quantité.');
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('La quantité doit être un nombre positif ou nul.');
    return n;
  }
  function adjustment(stock, inventory, key, inventoryId) {
    if (inventory.status !== 'approved') throw new Error('Approbation du superviseur requise.');
    const line = inventory.lines?.[key];
    if (!line) throw new Error('Ligne absente de cet inventaire.');
    if (stock.controlAdjustments?.[inventoryId]) return stock;
    if (quantity(stock.qty) !== quantity(line.theoretical)) throw new Error('Stock modifié depuis le gel : vérification requise.');
    const counted = quantity(line.counted);
    return {...stock, qty: counted, controlAdjustments: {...stock.controlAdjustments, [inventoryId]: {before: stock.qty, after: counted, delta: counted - stock.qty}}};
  }
  async function applyAdjustment(ref, inventory, key, inventoryId) {
    const keep = () => {};
    ref.on('value', keep);
    try {
      await ref.once('value');
      let failure;
      const result = await ref.transaction(stock => {
        failure = null;
        if (stock?.controlAdjustments?.[inventoryId]) return;
        try { if (!stock) throw new Error('Matériel introuvable.'); return adjustment(stock,inventory,key,inventoryId); }
        catch (error) { failure = error; return; }
      }, undefined, false);
      if (failure) throw failure;
      if (!result.snapshot.val()?.controlAdjustments?.[inventoryId]) throw new Error('Régularisation interrompue. Réessayez : les lignes déjà appliquées ne seront pas doublées.');
      return result.snapshot.val();
    } finally { ref.off('value', keep); }
  }
  const api = {operator, scopes, scopeMap, scopeKey, scopeKeys, scopedCollections, quantity, adjustment, applyAdjustment};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ControlCore = api;
})(typeof window === 'undefined' ? globalThis : window);
