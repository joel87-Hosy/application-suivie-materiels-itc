/* Dedicated control workspace. Operational quantities are never saved by a controller. */
(function () {
  'use strict';
  const C = ControlCore;
  const labels = {dashboard:'Tableau de bord', stock:'Stocks et matériels', flows:'Flux de stocks', missions:'Missions de contrôle', inventories:'Inventaires', audits:'Audits', anomalies:'Anomalies et régularisations', actions:'Plans d’action', reports:'Rapports et archives', notifications:'Notifications'};
  const statuses = {draft:'Brouillon', planned:'Planifié', counting:'Comptage en cours', review:'À approuver', approved:'Approuvé — à régulariser', closed:'Clôturé', cancelled:'Annulé', open:'Ouvert', progress:'En cours', verify:'À vérifier', justification:'À justifier', conform:'Conforme', anomaly:'Anomalie'};
  const checks = ['Justificatifs présents', 'Circuit de validation respecté', 'Bons et mouvements concordants', 'Retours et transferts tracés', 'Rangement et identification', 'État des matériels', 'Accès au magasin', 'Anomalies précédentes traitées'];
  const e = value => escapeHtml(String(value ?? ''));
  const now = () => new Date().toISOString();
  const entries = value => Object.entries(value || {}).map(([id, row]) => ({...row, id}));
  let state = {}, summaries = {}, op = '', section = 'dashboard', detail = null, unsubscribe = null, company = '', uid = '', generation = 0, search = '', from = '', to = '', flowTab = 'all', statusFilter = '', message = '', busy = false;
  let writeContext = null;
  const role = () => secureStore.profile?.role;
  const isController = () => role() === 'Contrôleur';
  const isSupervisor = () => role() === 'Superviseur';
  const isManager = () => role() === 'Gestionnaire';
  const allowed = () => ['Contrôleur','Superviseur','Gestionnaire'].includes(role());
  function ops() {
    return isSupervisor() || isController() ? [...new Set([...appData.stock.filter(s=>s.company_id === company).map(s => C.operator(s.op)), ...appData.users.filter(u=>u.company_id === company).flatMap(u => C.scopes(u.managedOps))])].filter(Boolean).sort() : C.scopes(secureStore.profile?.controlScopes);
  }
  const ref = path => db.ref(`stock_control/${writeContext?.company || company}/${writeContext?.op || op}${path ? '/' + path : ''}`);
  function stop() { if (unsubscribe) unsubscribe(); unsubscribe = null; generation++; }
  function reset() { stop(); state = {}; summaries = {}; detail = null; op = ''; uid = ''; company = ''; search = ''; message = ''; }
  function rows(kind) { return entries(state[kind]).sort((a,b) => String(b.createdAt || b.at).localeCompare(String(a.createdAt || a.at))); }
  function stocks() { return appData.stock.filter(s => s.company_id === company && C.operator(s.op) === op); }
  function filtered(list) {
    return list.filter(r => (!search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase())) && (!statusFilter || r.status === statusFilter) && (!from || String(r.createdAt || r.dateISO || '').slice(0,10) >= from) && (!to || String(r.createdAt || r.dateISO || '').slice(0,10) <= to));
  }
  const badge = s => `<span class="ctl-badge">${e(statuses[s] || s || '—')}</span>`;
  const person = id => appData.users?.find(u=>u.uid === id || String(u.id) === String(id))?.name || id || '—';
  const button = (action, title, extra = '') => `<button type="button" class="ctl-button" data-action="${e(action)}" ${extra}>${e(title)}</button>`;
  const field = (name, title, type = 'text', value = '', required = true) => `<label class="ctl-field">${e(title)}<input name="${e(name)}" type="${type}" value="${e(value)}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" step="any"' : ''}></label>`;
  const area = (name, title, value = '', required = false) => `<label class="ctl-field">${e(title)}<textarea name="${name}" maxlength="5000" ${required ? 'required' : ''}>${e(value)}</textarea></label>`;
  function table(headers, body) { return `<div class="ctl-table-wrap"><table class="ctl-table"><thead><tr>${headers.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="ctl-empty">Aucun élément pour ces filtres.</td></tr>`}</tbody></table></div>`; }
  function card(title, body) { return `<section class="ctl-card"><h3>${e(title)}</h3>${body}</section>`; }
  async function enter(id) {
    if (!allowed()) { document.getElementById('app-container').textContent = 'Accès réservé au contrôle des stocks.'; return; }
    if (uid !== secureStore.uid || company !== secureStore.profile.company_id) reset();
    uid = secureStore.uid; company = secureStore.profile.company_id;
    section = id.replace('control-', ''); if (!labels[section]) section = 'dashboard';
    detail = null; statusFilter = '';
    const available = ops(); if (!available.includes(op)) op = available[0] || '';
    await subscribe();
  }
  async function subscribe() {
    stop(); state = {}; summaries = {}; message = ''; draw();
    if (!op) return;
    const token = generation;
    const subscriptions = [];
    for (const stockOp of ops()) {
    const target = db.ref(`stock_control/${company}/${stockOp}`);
    const callback = snap => {
      if (token !== generation) return;
      summaries[stockOp] = snap.val() || {};
      if (stockOp === op) state = summaries[stockOp];
      // Preserve a form being edited; listeners update the data model only.
      if (!detail && !document.querySelector('#app-container .ctl-editor')) draw();
    };
    const fail = error => { if (token === generation) { message = 'Chargement impossible : ' + error.message; draw(); } };
    target.on('value', callback, fail); subscriptions.push([target,callback]);
    }
    unsubscribe = () => subscriptions.forEach(([target,callback]) => target.off('value',callback));
  }
  async function run(work) {
    if (busy) return;
    busy = true;
    writeContext = {company,op,uid};
    const token = generation;
    message = '';
    const statusElement = document.getElementById('ctl-message'); if (statusElement) statusElement.textContent = '';
    const lockedElements = [...document.querySelectorAll('#app-container button, #app-container input, #app-container select, #app-container textarea')].filter(el=>!el.disabled);
    lockedElements.forEach(el=>{el.disabled=true;});
    try { await work(); if (token !== generation) return; message = 'Enregistrement effectué.'; state = (await ref('').once('value')).val() || {}; draw(); }
    catch (error) { if (token !== generation) return; message = error.message || String(error); const status = document.getElementById('ctl-message'); if (status) { status.textContent = message; status.setAttribute('role','alert'); } }
    finally { busy = false; writeContext = null; lockedElements.forEach(el=>{el.disabled=false;}); }
  }
  async function log(text, recordId) { await ref('events').push({actorUid: writeContext?.uid || uid, at: now(), message: text, recordId: recordId || ''}); }
  function draw() {
    const container = document.getElementById('app-container');
    if (!container || !String(currentSectionId).startsWith('control-')) return;
    document.getElementById('view-title').textContent = labels[section];
    container.innerHTML = `<div class="ctl-workspace"><header class="ctl-hero"><div><p>ESPACE CONTRÔLE DES STOCKS</p><h2>${e(labels[section])}</h2><p>${e(currentUser.name || currentUser.email)} · ${e(role())}</p></div><label>Stock<select id="ctl-op">${ops().map(v => `<option ${v === op ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label></header>
      <nav class="ctl-tabs" aria-label="Modules de contrôle">${Object.entries(labels).map(([key,title]) => `<button type="button" data-page="${key}" aria-current="${key === section ? 'page' : 'false'}">${e(title)}${key === 'notifications' ? ' ('+rows('events').filter(ev => ev.at > (state.preferences?.[uid]?.lastSeen || '')).length+')' : ''}</button>`).join('')}</nav>
      <p id="ctl-message" role="status" aria-live="polite">${e(message)}</p>
      ${!op ? `<div class="ctl-card">${isController() ? 'Aucun stock disponible dans votre entreprise.' : 'Aucun stock affecté. Le superviseur doit renseigner les accès du compte.'}</div>` : `${section === 'dashboard' && isController() ? '' : `<div class="ctl-toolbar">${field('search','Recherche','search',search,false)}${field('from','Du','date',from,false)}${field('to','Au','date',to,false)}${button('filter','Filtrer')}${button('clear','Réinitialiser')}</div>`}${state.lock ? `<div class="ctl-warning">Inventaire en cours : les modifications du stock ${e(op)} sont gelées jusqu’à sa clôture ou son annulation.</div>` : ''}${detail ? renderDetail() : renderPage()}`}</div>`;
    container.onclick = event => { const b = event.target.closest('button'); if (!b) return; if (b.dataset.page) { showSection('control-' + b.dataset.page); return; } if (b.dataset.action) handle(b.dataset.action, b.dataset); };
    container.onchange = event => { if (event.target.id === 'ctl-op') { op = event.target.value; detail = null; subscribe(); } if (event.target.id === 'ctl-status') { statusFilter = event.target.value; draw(); } };
    container.onsubmit = event => { if (!event.target.matches('.ctl-editor')) return; event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); run(() => submit(data, event.target)); };
  }
  function renderPage() {
    if (section === 'dashboard' && isController()) return renderControllerDashboard();
    if (section === 'dashboard') {
      const inventories = rows('inventories'), anomalies = rows('anomalies'), actions = rows('actions');
      const activeInv = inventories.filter(r => !['closed','cancelled'].includes(r.status));
      const overdue = actions.filter(r => r.status !== 'closed' && r.due && r.due < now().slice(0,10));
      const metrics = [['Matériels suivis',stocks().length],['Inventaires en cours',activeInv.length],['Anomalies ouvertes',anomalies.filter(r => r.status !== 'closed').length],['Actions en retard',overdue.length],['À approuver',inventories.filter(r => r.status === 'review').length],['Anomalies critiques',anomalies.filter(r => r.severity === 'Critique' && r.status !== 'closed').length]];
      return `${card('Synthèse de vos '+ops().length+' stocks',table(['Stock','Dernier inventaire clôturé','Conformité des lignes','Anomalies ouvertes','État'],ops().map(stockOp => {
        const summary = summaries[stockOp] || {};
        const last = entries(summary.inventories).filter(i => i.status === 'closed').sort((a,b) => String(b.referenceAt).localeCompare(String(a.referenceAt)))[0];
        const lines = Object.values(last?.lines || {});
        const rate = lines.length ? Math.round(lines.filter(l => l.counted === l.theoretical).length/lines.length*100)+' %' : '—';
        return `<tr><td>${e(stockOp)}</td><td>${e(last?.referenceAt || 'Jamais')}</td><td>${rate}</td><td>${entries(summary.anomalies).filter(a => a.status !== 'closed').length}</td><td>${summary.lock ? 'Inventaire en cours' : 'Disponible'}</td></tr>`;
      }).join('')))}<div class="ctl-metrics">${metrics.map(([title,n]) => `<div class="ctl-card"><strong>${n}</strong><span>${title}</span></div>`).join('')}</div>${isController() ? `<div class="ctl-toolbar">${button('new','Créer une mission','data-kind="missions"')}${button('new','Lancer un inventaire','data-kind="inventories"')}${button('new','Signaler une anomalie','data-kind="anomalies"')}</div>` : ''}${card('Travail à traiter', recordTable([...activeInv.map(r => ({...r,kind:'inventories'})), ...overdue.map(r => ({...r,kind:'actions'}))]))}${card('Activité récente', eventList(rows('events').slice(0,10)))}`;
    }
    if (section === 'stock') return card('Stock théorique actuel', table(['Matériel','Catégorie','Quantité','Dernier comptage','Écart au comptage','Actions'], filtered(stocks()).map(s => {
      const last = rows('inventories').filter(i => i.status === 'closed' && i.lines?.[s._dbKey]).sort((a,b) => String(b.referenceAt).localeCompare(String(a.referenceAt)))[0];
      const line = last?.lines[s._dbKey];
      return `<tr><td>${e(s.label)}</td><td>${e(s.type)}</td><td>${e(s.qty)}</td><td>${line ? e(line.counted) + ' · ' + e(last.referenceAt) : 'Jamais'}</td><td>${line ? e(line.counted - line.theoretical) : '—'}</td><td>${button('material','Fiche',`data-id="${e(s._dbKey)}"`)}</td></tr>`;
    }).join('')));
    if (section === 'flows') return renderFlows();
    if (section === 'notifications') return card('Activité et échéances', `${button('mark-read','Tout marquer comme lu')}<p>Les événements de ce stock sont conservés avec leur auteur et leur date.</p>${eventList(rows('events'))}${recordTable(rows('actions').filter(a => a.status !== 'closed' && a.due && a.due <= now().slice(0,10)).map(r => ({...r,kind:'actions'})))}`);
    if (section === 'reports') {
      const list = ['inventories','audits','anomalies','actions'].flatMap(kind => rows(kind).map(r => ({...r,kind})));
      return card('Rapports et archives', `<div class="ctl-toolbar">${button('csv','Exporter la synthèse CSV')}${button('print','Imprimer / Enregistrer en PDF')}</div><p>Ouvrez un dossier pour exporter son détail. Les dossiers clôturés sont conservés en lecture seule.</p>${recordTable(filtered(list))}`);
    }
    return card(labels[section], `${isController() ? button('new','Créer',`data-kind="${section}"`) : ''}<label class="ctl-field">Statut<select id="ctl-status"><option value="">Tous</option>${Object.entries(statuses).map(([k,v]) => `<option value="${k}" ${statusFilter === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${recordTable(filtered(rows(section)).map(r => ({...r,kind:section})))}`);
  }
  function dashboardBars(title, description, groups, page) {
    const max = Math.max(1,...groups.map(g=>g.value));
    const total = groups.reduce((sum,g)=>sum+g.value,0);
    return card(title,`<figure class="ctl-chart" aria-label="${e(title)}"><figcaption>${e(description)}</figcaption>
      <div class="ctl-chart-bars">${groups.map(g=>`<button type="button" class="ctl-chart-row" data-page="${page}" aria-label="${e(g.label)} : ${g.value}. Ouvrir ${e(labels[page])}"><span class="ctl-chart-label"><i class="ctl-chart-key" style="background:${g.color}" aria-hidden="true"></i>${e(g.label)}</span><span class="ctl-chart-track" aria-hidden="true"><span style="width:${g.value/max*100}%;background:${g.color}"></span></span><strong>${g.value}</strong></button>`).join('')}</div>
      <p class="ctl-muted">Légende : chaque couleur correspond au libellé de sa ligne. Les barres représentent un nombre de dossiers, sur la même échelle dans ce graphique. Cliquez sur une ligne pour ouvrir le module.</p>
      ${total ? `<p><strong>${total}</strong> dossier(s) au total.</p>` : '<p class="ctl-empty">Aucun dossier à représenter pour ce stock.</p>'}</figure>`);
  }
  function conformityChart(matching, counted, total) {
    const groups = [{label:'Conformes',value:matching,color:'#0f766e'},{label:'En écart',value:counted-matching,color:'#c2410c'},{label:'Non évaluables',value:total-counted,color:'#64748b'}];
    if (!total) return '<p class="ctl-empty">Aucune ligne à représenter dans cet inventaire.</p>';
    let offset = 0;
    const segments = groups.filter(g=>g.value).map(g=>{
      const length=g.value/total*100;
      const segment=`<circle cx="60" cy="60" r="45" fill="none" stroke="${g.color}" stroke-width="16" pathLength="100" stroke-dasharray="${length} ${100-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`;
      offset+=length;return segment;
    }).join('');
    return `<figure class="ctl-chart ctl-conformity-chart" aria-label="Répartition des lignes du dernier inventaire clôturé"><svg viewBox="0 0 120 120" role="img" aria-label="${groups.map(g=>`${g.value} ${g.label}`).join(', ')}">${segments}<text x="60" y="58" text-anchor="middle" fill="#183044" font-size="20" font-weight="bold">${total}</text><text x="60" y="74" text-anchor="middle" fill="#526778" font-size="10">lignes</text></svg><figcaption><ul class="ctl-chart-legend">${groups.map(g=>`<li><i class="ctl-chart-key" style="background:${g.color}" aria-hidden="true"></i><span>${g.label}</span><strong>${g.value}</strong></li>`).join('')}</ul><p class="ctl-muted">Conforme : quantité comptée égale au stock théorique. En écart : différence constatée. Non évaluable : données de comptage incomplètes.</p></figcaption></figure>`;
  }
  function renderControllerDashboard() {
    if (!Object.prototype.hasOwnProperty.call(summaries, op)) return '<p class="ctl-empty" role="status">Chargement des indicateurs du stock…</p>';
    const today = now().slice(0,10);
    const active = r => !['closed','cancelled'].includes(r.status);
    const inventories = rows('inventories'), anomalies = rows('anomalies').filter(active);
    const actions = rows('actions').filter(active), audits = rows('audits').filter(active);
    const missions = rows('missions').filter(active);
    const late = r => !!r.due && r.due < today;
    const pendingActions = actions.filter(r => r.status === 'verify' || r.response);
    const latest = inventories.filter(r => r.status === 'closed').sort((a,b) => String(b.referenceAt || b.createdAt).localeCompare(String(a.referenceAt || a.createdAt)))[0];
    const lines = Object.values(latest?.lines || {});
    const counted = lines.filter(l => l.counted !== undefined && l.counted !== null && Number.isFinite(Number(l.counted)) && Number.isFinite(Number(l.theoretical)));
    const matching = counted.filter(l => Number(l.counted) === Number(l.theoretical)).length;
    const date = value => value ? e(String(value).slice(0,10)) : 'Non renseignée';
    const link = (page,title) => `<button type="button" class="ctl-button" data-page="${page}">${e(title)}</button>`;
    const metrics = [
      ['Inventaires actifs',inventories.filter(active).length,'inventories','Brouillons, comptages et validations'],
      ['Anomalies ouvertes',anomalies.length,'anomalies',`${anomalies.filter(r => r.severity === 'Critique').length} critique(s)`],
      ['Actions à vérifier',pendingActions.length,'actions','Réponse reçue ou statut À vérifier'],
      ['Actions en retard',actions.filter(late).length,'actions','Échéance dépassée, hors dossiers clos'],
      ['Audits en cours',audits.length,'audits','Audits restant à clôturer'],
      ['Missions actives',missions.length,'missions','Contrôles à préparer ou à terminer'],
    ];
    const priorities = [
      ...anomalies.map(r => ({...r,kind:'anomalies',priority:r.severity === 'Critique' ? 0 : 3,reason:r.severity === 'Critique' ? 'Anomalie critique' : 'Anomalie à traiter'})),
      ...actions.map(r => ({...r,kind:'actions',priority:late(r) ? 1 : pendingActions.includes(r) ? 2 : 5,reason:late(r) ? 'Action en retard' : pendingActions.includes(r) ? 'Réalisation à vérifier' : 'Action à suivre'})),
      ...inventories.filter(r => ['draft','counting'].includes(r.status)).map(r => ({...r,kind:'inventories',priority:2,reason:r.status === 'counting' ? 'Comptage à terminer' : 'Inventaire à préparer'})),
      ...[...audits.map(r=>({...r,kind:'audits'})),...missions.map(r=>({...r,kind:'missions'}))].map(r=>({...r,priority:late(r)?1:4,reason:late(r)?'Échéance dépassée':r.due === today?'À traiter aujourd’hui':'Contrôle à poursuivre'})),
    ].sort((a,b)=>a.priority-b.priority || String(a.due || '9999').localeCompare(String(b.due || '9999')));
    const pending = inventories.filter(r => ['review','approved'].includes(r.status));
    const severityGroups = [['Critique','#b91c1c'],['Élevée','#c2410c'],['Moyenne','#a16207'],['Faible','#0369a1']].map(([label,color])=>({label,color,value:anomalies.filter(r=>r.severity===label).length}));
    severityGroups.push({label:'Non renseignée',color:'#64748b',value:anomalies.filter(r=>!severityGroups.some(g=>g.label===r.severity)).length});
    const inventoryGroups = [['draft','#64748b'],['counting','#0369a1'],['review','#a16207'],['approved','#7e22ce'],['closed','#0f766e'],['cancelled','#475569']].map(([status,color])=>({label:statuses[status],color,value:inventories.filter(r=>r.status===status).length}));
    const otherInventories = inventories.filter(r=>!['draft','counting','review','approved','closed','cancelled'].includes(r.status)).length;
    if(otherInventories) inventoryGroups.push({label:'Autre statut',color:'#334155',value:otherInventories});
    const overview = ops().map(stockOp => {
      if (!Object.prototype.hasOwnProperty.call(summaries,stockOp)) return `<tr><td>${e(stockOp)}</td><td colspan="4">Chargement…</td></tr>`;
      const summary = summaries[stockOp];
      const last = entries(summary.inventories).filter(r=>r.status === 'closed').sort((a,b)=>String(b.referenceAt || b.createdAt).localeCompare(String(a.referenceAt || a.createdAt)))[0];
      return `<tr><td><strong>${e(stockOp)}</strong>${stockOp === op ? '<small>Stock sélectionné</small>' : ''}</td><td>${last ? date(last.referenceAt || last.createdAt) : 'Jamais inventorié'}</td><td>${entries(summary.anomalies).filter(active).length}</td><td>${summary.lock ? 'Gelé pour inventaire' : 'Disponible'}</td><td>${button('dashboard-stock','Consulter',`data-op="${e(stockOp)}"`)}</td></tr>`;
    }).join('');
    return `<section class="ctl-dashboard-intro"><div><p class="ctl-eyebrow">TABLEAU DE BORD CONTRÔLEUR</p><h3>Vos contrôles sur ${e(op)}</h3><p>Indicateurs du stock sélectionné · Tous les dossiers, y compris ceux des autres contrôleurs.</p></div><span class="ctl-badge">${stocks().length} matériels suivis</span></section>
      <div class="ctl-metrics ctl-controller-metrics">${metrics.map(([title,value,page,hint])=>`<button type="button" class="ctl-card ctl-metric-link" data-page="${page}"><span>${e(title)}</span><strong>${value}</strong><small>${e(hint)}</small></button>`).join('')}</div>
      <div class="ctl-toolbar" aria-label="Créer un contrôle sur le stock sélectionné">${button('new','Lancer un inventaire','data-kind="inventories"')}${button('new','Créer un audit','data-kind="audits"')}${button('new','Créer une mission','data-kind="missions"')}${button('new','Signaler une anomalie','data-kind="anomalies"')}</div>
      <div class="ctl-dashboard-grid">${dashboardBars('Anomalies par gravité','Stock '+op+' · Anomalies ouvertes uniquement, hors dossiers clôturés ou annulés.',severityGroups,'anomalies')}${dashboardBars('Avancement des inventaires','Stock '+op+' · Répartition actuelle de tous les inventaires enregistrés, y compris clôturés et annulés.',inventoryGroups,'inventories')}</div>
      ${card('Priorités du stock',priorities.length ? `<p>${priorities.length} dossier(s) à suivre. Les urgences sont affichées en premier (10 maximum).</p>${table(['Priorité','Dossier','Suivi','Échéance','Action'],priorities.slice(0,10).map(r=>`<tr><td><span class="ctl-badge ${r.priority < 2 ? 'ctl-badge-alert' : ''}">${e(r.reason)}</span></td><td>${e(r.title)}<small>${e(labels[r.kind])}</small></td><td>${badge(r.status)}<small>${r.createdBy === uid ? 'Votre dossier' : 'Créé par '+e(person(r.createdBy))}</small></td><td>${r.due ? date(r.due) : 'Sans échéance'}</td><td>${button('open','Ouvrir',`data-kind="${r.kind}" data-id="${e(r.id)}"`)}</td></tr>`).join(''))}` : '<p class="ctl-empty">Aucun dossier à traiter sur ce stock. Vous pouvez préparer un inventaire ou un audit.</p>')}
      <div class="ctl-dashboard-grid">${card('Dernier inventaire clôturé',latest ? `<p><strong>${e(latest.title)}</strong> · ${date(latest.referenceAt || latest.createdAt)}</p><p class="ctl-compliance">${counted.length === lines.length && lines.length ? Math.round(matching/lines.length*100)+' %' : 'Non disponible'}</p><p>Conformité au stock théorique lors du comptage.</p>${conformityChart(matching,counted.length,lines.length)}<p>${matching} ligne(s) conforme(s) sur ${lines.length} · ${counted.length-matching} ligne(s) en écart.</p><p class="ctl-muted">Ce résultat porte uniquement sur les matériels de cet inventaire, avant régularisation.</p>${button('open','Consulter l’inventaire',`data-kind="inventories" data-id="${e(latest.id)}"`)}` : '<p>Aucun inventaire clôturé sur ce stock. La conformité sera disponible après le premier inventaire.</p>')}
      ${card('En attente du superviseur',`<p>${pending.filter(r=>r.status === 'review').length} inventaire(s) à approuver · ${pending.filter(r=>r.status === 'approved').length} à régulariser.</p><p class="ctl-muted">Le superviseur valide les écarts et applique les corrections de quantité.</p>${pending.length ? recordTable(pending.map(r=>({...r,kind:'inventories'}))) : '<p>Aucune décision en attente.</p>'}`)}</div>
      ${card('Vue des stocks de l’entreprise',`<p>Comparez les stocks et choisissez celui à contrôler.</p>${table(['Stock','Dernier inventaire clôturé','Anomalies ouvertes','État','Action'],overview)}`)}
      ${card('Activité récente du stock',`${eventList(rows('events').slice(0,8))}${link('notifications','Voir toute l’activité')}`)}`;
  }
  function recordTable(list) { return table(['Dossier','Statut','Responsable','Échéance','Actions'], list.map(r => `<tr><td>${e(r.title)}<small>${e(r.id)}</small></td><td>${badge(r.status)}</td><td>${e(r.assignee || person(r.createdBy))}</td><td>${e(r.due || '—')}</td><td>${button('open','Ouvrir',`data-kind="${e(r.kind)}" data-id="${e(r.id)}"`)}</td></tr>`).join('')); }
  function eventList(list) { return `<ul class="ctl-events">${list.map(r => `<li><time>${e(r.at)}</time><p>${e(r.message)}</p><small>${e(person(r.actorUid))}</small></li>`).join('') || '<li>Aucun événement.</li>'}</ul>`; }
  function movements() {
    const list = [];
    for (const r of rows('checks').filter(r=>r.source==='transfer')) list.push({...r,source:'checks',flow:'transfer',qty:r.sentQty,status:r.receivedQty === undefined ? 'Réception à justifier' : r.receivedQty === r.sentQty ? 'Quantités concordantes' : 'Écart : '+(r.receivedQty-r.sentQty)});
    for (const r of appData.stockMovements || []) if (r.company_id === company && C.operator(r.op) === op) list.push({...r,source:'stockMovements',id:r._dbKey,title:r.label,flow:r.type,status:'Enregistré'});
    for (const kind of ['sorties','retours','demandes']) for (const r of appData[kind] || []) if (r.company_id === company && C.operator(r.op) === op) list.push({...r, source:kind, id:r._dbKey, title:r.id || r.label || kind, flow:kind === 'sorties' ? 'out' : kind === 'retours' ? 'return' : 'order'});
    for (const i of rows('inventories').filter(i => ['approved','closed'].includes(i.status))) for (const [key, line] of Object.entries(i.lines || {})) {
      if (stocks().find(s => s._dbKey === key)?.controlAdjustments?.[i.id]) list.push({id:i.id + '_' + key,source:'adjustments',title:line.label,flow:'adjustment',qty:line.counted-line.theoretical,createdAt:i.referenceAt,status:i.status});
    }
    return list;
  }
  function renderFlows() {
    const tabs = {all:'Tous',in:'Entrées',out:'Sorties',return:'Retours',transfer:'Transferts',order:'Bons',adjustment:'Régularisations'};
    return card('Traçabilité des mouvements', `<div class="ctl-tabs">${Object.entries(tabs).map(([id,t]) => button('flow-tab',t,`data-id="${id}"`)).join('')}</div>${isController() ? button('new-transfer','Contrôler un transfert') : ''}<p>Le journal conserve les nouvelles variations de quantités avec leur auteur et les quantités avant/après. Les bons historiques restent consultables.</p>${table(['Référence','Type','Date','Quantité / articles','Statut opérationnel','Contrôle','Actions'], filtered(movements().filter(r => flowTab === 'all' || r.flow === flowTab)).map(r => {
      const check = rows('checks').find(c => c.sourceId === r.id && c.source === r.source);
      return `<tr><td>${e(r.title)}</td><td>${e(tabs[r.flow])}</td><td>${e(r.createdAt || r.date || '—')}</td><td>${e(r.qty ?? (r.items || []).map(i => `${i.label}: ${i.qty}`).join(', '))}</td><td>${e(r.status || r.statut)}</td><td>${badge(check?.status || 'À contrôler')}</td><td>${button(r.flow === 'transfer' ? 'open' : 'movement','Détails',`data-id="${e(r.id)}" data-kind="${e(r.source)}"`)}${isController() && r.flow !== 'transfer' ? button('check','Contrôler',`data-id="${e(r.id)}" data-kind="${e(r.source)}"`) : ''}</td></tr>`;
    }).join(''))}`);
  }
  function renderDetail() {
    if (detail.mode === 'create') return createForm(detail.kind);
    if (detail.mode === 'material') {
      const s = stocks().find(r => r._dbKey === detail.id);
      if (!s) return 'Matériel introuvable.';
      return card(s.label, `${button('back','Retour')}<dl class="ctl-details">${Object.entries(s).filter(([k]) => !['_dbKey','_order','controlAdjustments'].includes(k)).map(([k,v]) => `<dt>${e(k)}</dt><dd>${e(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`).join('')}</dl><h4>Inventaires associés</h4>${recordTable(rows('inventories').filter(i => i.lines?.[detail.id]).map(r => ({...r,kind:'inventories'})))}`);
    }
    if (detail.mode === 'movement') {
      const r = movements().find(r => r.id === detail.id && r.source === detail.kind);
      if (!r) return card('Mouvement',`${button('back','Retour')}<p>Mouvement introuvable.</p>`);
      const info = {'Référence':r.reference || r.title,'Matériel':r.label || (r.items || []).map(i=>i.label).join(', '),'Quantité':r.qty,'Quantité avant':r.before,'Quantité après':r.after,'Date':r.createdAt || r.date,'Auteur':appData.users.find(u=>u.uid===r.actorUid)?.name || r.actorUid || r.techName || r.demandeurName,'Statut':r.status || r.statut,'Motif':r.motif || r.commentaire};
      return card('Pièce de mouvement', `${button('back','Retour')}<dl class="ctl-details">${Object.entries(info).filter(([,v])=>v!==undefined).map(([k,v])=>`<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl>${r.items ? table(['Matériel','Quantité'],r.items.map(i=>`<tr><td>${e(i.label)}</td><td>${e(i.qty)}</td></tr>`).join('')) : ''}`);
    }
    const r = state[detail.kind]?.[detail.id];
    if (!r) return card('Dossier', `${button('back','Retour')}<p>Dossier absent ou inaccessible.</p>`);
    if (detail.kind === 'inventories') return inventoryDetail(r);
    const editable = isController() && r.createdBy === uid && r.status !== 'closed';
    return card(r.title, `${button('back','Retour')} ${button('refresh','Actualiser le dossier')} ${badge(r.status)} ${button('print','PDF / Imprimer')}
      <p>${e(r.description || '')}</p><p>Responsable : ${e(r.assignee || '—')} · Échéance : ${e(r.due || '—')} · Gravité : ${e(r.severity || '—')}</p>${r.evidence ? `<p>Justificatifs : ${e(r.evidence)}</p>` : ''}
      ${r.source === 'transfer' ? `<p>Transfert contrôlé : ${e(op)} → ${e(r.toStock)} · Expédié : ${e(r.sentQty)} · Reçu : ${e(r.receivedQty ?? 'À justifier')} · Écart : ${r.receivedQty === undefined ? '—' : e(r.receivedQty-r.sentQty)}</p>` : ''}
      ${detail.kind === 'audits' ? auditForm(r,editable) : ''}${attachments(r,editable)}
      ${r.response ? card('Réponse du gestionnaire', `<p>${e(r.response.text)}</p><small>${e(r.response.by)} · ${e(r.response.at)}</small>`) : ''}
      ${r.decision ? card('Décision du superviseur', `<p>${e(r.decision.text)}</p><small>${e(r.decision.by)} · ${e(r.decision.at)}</small>`) : ''}
      ${editable ? `<form class="ctl-editor" data-mode="update">${r.source === 'transfer' ? field('receivedQty','Quantité réceptionnée vérifiée','number',r.receivedQty ?? '',false) : ''}${area('description','Observations et conclusions',r.description)}${area('evidence','Preuves : références de bons et liens vers documents',r.evidence)}<label class="ctl-field">Statut<select name="status">${(detail.kind === 'checks' ? ['open','conform','justification','anomaly','closed'] : ['open','planned','progress','justification','verify','closed']).map(s => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${statuses[s]}</option>`).join('')}</select></label><button class="ctl-button">Enregistrer</button></form>` : ''}
      ${isManager() && r.status !== 'closed' ? responseForm('response','Répondre / fournir une preuve de réalisation') : ''}
      ${isSupervisor() && !r.decision && r.status !== 'closed' ? responseForm('decision','Décision / arbitrage') : ''}
      ${isController() ? `<div class="ctl-toolbar">${button('linked','Créer une anomalie liée','data-kind="anomalies"')}${button('linked','Créer une action corrective','data-kind="actions"')}</div>` : ''}
      ${card('Historique du dossier',eventList(rows('events').filter(ev => ev.recordId === detail.id)))}`);
  }
  function responseForm(mode,title) { return `<form class="ctl-editor" data-mode="${mode}">${area('text',title,'',true)}<button class="ctl-button">Envoyer</button></form>`; }
  function attachments(r,editable) {
    return `<h4>Pièces justificatives</h4><ul>${entries(r.attachments).map(a=>`<li>${e(a.name)} (${Math.round(a.size/1024)} Ko) ${button('download','Télécharger',`data-id="${e(a.id)}"`)}</li>`).join('') || '<li>Aucune pièce jointe.</li>'}</ul>${editable ? '<form class="ctl-editor" data-mode="attachment"><label class="ctl-field">Photo ou document (PNG, JPEG, PDF, 256 Ko maximum)<input type="file" name="file" accept="image/png,image/jpeg,application/pdf" required></label><button class="ctl-button">Joindre la pièce</button></form>' : ''}`;
  }
  function auditForm(r, editable) {
    return `<form class="ctl-editor" data-mode="audit"><h4>Points de contrôle</h4>${checks.map((title,index) => {
      const c = r.checklist?.[index] || {};
      return `<fieldset class="ctl-check"><legend>${e(title)}</legend><select name="result-${index}" ${editable ? '' : 'disabled'}>${['Non vérifié','Conforme','Non conforme','Non applicable'].map(v => `<option ${c.result === v ? 'selected' : ''}>${v}</option>`).join('')}</select>${area('proof-'+index,'Observation et preuve',c.proof || '')}</fieldset>`;
    }).join('')}${editable ? '<button class="ctl-button">Enregistrer les vérifications</button>' : ''}</form>`;
  }
  function createForm(kind) {
    return card('Nouveau dossier — ' + (labels[kind] || 'Contrôle de mouvement'), `${button('back','Retour')}<form class="ctl-editor" data-mode="create" data-kind="${kind}">${field('title','Objet / référence du bon','text',detail.sourceId ? 'Contrôle ' + detail.sourceId : '')}${detail.source === 'transfer' ? `${field('toStock','Stock destinataire')}${field('sentQty','Quantité expédiée vérifiée','number')}<p>Cette fiche rapproche les justificatifs d’expédition et de réception. Elle ne déclenche aucun mouvement de matériel.</p>` : ''}${area('description','Périmètre et objectif')}${field('assignee','Gestionnaire / responsable','text','',false)}${field('due','Échéance','date','',false)}${kind === 'inventories' ? '<label class="ctl-field">Type<select name="type"><option>Complet</option><option>Tournant</option><option>Ciblé</option></select></label><p>Le stock est gelé au démarrage. Sélectionnez ensuite les matériels à compter. Le gestionnaire et le contrôleur disposent de saisies distinctes.</p>' : ''}${kind === 'anomalies' ? '<label class="ctl-field">Gravité<select name="severity"><option>Faible</option><option>Moyenne</option><option>Élevée</option><option>Critique</option></select></label>' : ''}${area('evidence','Références de bons et liens des pièces justificatives')}<button class="ctl-button">Créer le dossier</button></form>`);
  }
  function inventoryDetail(r) {
    const editable = isController() && r.createdBy === uid;
    const blind = r.status === 'counting';
    const lines = Object.entries(r.lines || {});
    return card(r.title, `${button('back','Retour')} ${button('refresh','Actualiser le dossier')} ${badge(r.status)} ${button('print','Procès-verbal PDF')}
      <p>Type : ${e(r.type)} · Référence : ${e(r.referenceAt || 'À fixer au démarrage')} · Gestionnaire : ${e(r.assignee || '—')}</p>
      ${r.status === 'draft' && editable ? `<p>Sélectionnez les matériels. Tout le stock ${e(op)} sera gelé pendant cet inventaire.</p><form class="ctl-editor" data-mode="start">${stocks().map(s => `<label class="ctl-check"><input type="checkbox" name="stock-${e(s._dbKey)}" checked> ${e(s.label)} (${e(s.type)})</label>`).join('')}<button class="ctl-button">Geler le stock et commencer</button></form>` : ''}
      ${lines.length ? `<form class="ctl-editor" data-mode="counts">${table(['Matériel', ...(blind ? [] : ['Théorique']), 'Comptage contrôleur','Comptage gestionnaire', ...(blind ? [] : ['Écart']), 'État / observation'],lines.map(([key,line]) => `<tr><td>${e(line.label)}</td>${blind ? '' : `<td>${e(line.theoretical)}</td>`}<td>${blind && editable ? `<input aria-label="Comptage contrôleur ${e(line.label)}" type="number" min="0" step="any" name="count-${e(key)}" value="${e(line.counted ?? '')}">` : blind && isManager() ? 'Masqué pendant le comptage' : e(line.counted ?? 'Non compté')}</td><td>${blind && isManager() ? `<input aria-label="Comptage gestionnaire ${e(line.label)}" type="number" min="0" step="any" name="manager-${e(key)}" value="${e(r.managerCounts?.[key]?.qty ?? '')}">` : blind && editable ? 'Masqué pendant le comptage' : e(r.managerCounts?.[key]?.qty ?? 'Non compté')}</td>${blind ? '' : `<td>${line.counted === undefined ? '—' : e(line.counted - line.theoretical)}</td>`}<td>${blind && editable ? `<input name="note-${e(key)}" aria-label="État et observation ${e(line.label)}" value="${e(line.note || '')}" maxlength="500">` : e(line.note || '')}</td></tr>`).join(''))}${blind && (editable || isManager()) ? '<button class="ctl-button">Enregistrer le comptage</button>' : ''}</form>` : ''}
      ${r.managerResponse ? card('Observations contradictoires du gestionnaire',`<p>${e(r.managerResponse.text)}</p><small>${e(r.managerResponse.by)} · ${e(r.managerResponse.at)}</small>`) : ''}
      ${isManager() && ['counting','review'].includes(r.status) ? responseForm('managerResponse','Observations / accord ou désaccord sur le comptage') : ''}
      ${r.decision ? card('Décision du superviseur',`<p>${e(r.decision.text)}</p><small>${e(r.decision.by)} · ${e(r.decision.at)}</small>`) : ''}
      ${attachments(r,editable && ['draft','counting'].includes(r.status))}
      <div class="ctl-toolbar">${editable && r.status === 'counting' ? button('submit-inventory','Soumettre au superviseur') : ''}${editable && r.status === 'review' ? button('recount','Demander un recomptage') : ''}${(editable || isSupervisor()) && ['draft','counting','review'].includes(r.status) ? button('cancel-inventory','Annuler et libérer le stock') : ''}${isSupervisor() && r.status === 'approved' ? button('apply-inventory','Appliquer les régularisations et clôturer') : ''}${['closed','cancelled'].includes(r.status) && state.lock === detail.id ? button('unlock','Libérer le stock') : ''}${editable ? button('linked','Créer une anomalie liée','data-kind="anomalies"') : ''}</div>
      ${isSupervisor() && r.status === 'review' ? `<form class="ctl-editor" data-mode="approve">${area('text','Décision motivée','',true)}<label class="ctl-field">Décision<select name="status"><option value="approved">Approuver la régularisation</option><option value="counting">Demander une reprise</option></select></label><button class="ctl-button">Valider la décision</button></form>` : ''}
      ${card('Historique',eventList(rows('events').filter(ev => ev.recordId === detail.id)))}`);
  }
  async function submit(data, form) {
    const mode = form.dataset.mode;
    if (mode === 'create') {
      if (!isController()) throw new Error('Création réservée au contrôleur.');
      const kind = form.dataset.kind;
      const row = {...data,title:data.title.trim(),createdBy:uid,createdAt:now(),status:kind === 'inventories' ? 'draft' : 'open'};
      if (detail.source === 'transfer') { row.source = 'transfer';row.sentQty = C.quantity(data.sentQty);row.toStock = C.operator(data.toStock);if (!row.toStock || row.toStock === op) throw new Error('Indiquez un stock destinataire différent.'); }
      if (!row.title) throw new Error('Objet obligatoire.');
      if (detail.sourceId) { row.sourceId = detail.sourceId; row.source = detail.source || ''; }
      const target = ref(kind).push(); await target.set(row); await log('Création : '+row.title,target.key); detail = {kind,id:target.key}; return;
    }
    const {kind,id} = detail; const r = (await ref(`${kind}/${id}`).once('value')).val();
    if (!r) throw new Error('Dossier introuvable.');
    if (mode === 'attachment') {
      const file = form.querySelector('[name=file]').files[0];
      if (!file || !['image/png','image/jpeg','application/pdf'].includes(file.type) || file.size > 262144) throw new Error('Choisissez un fichier PNG, JPEG ou PDF de 256 Ko maximum.');
      const encoded = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Lecture du fichier impossible.'));reader.readAsDataURL(file);});
      await ref(`${kind}/${id}/attachments`).push({name:file.name,type:file.type,size:file.size,data:encoded,by:uid,at:now()});await log('Pièce justificative ajoutée : '+file.name,id);return;
    }
    if (mode === 'start') {
      const keys = Object.keys(data).filter(k => k.startsWith('stock-')).map(k => k.slice(6));
      if (!keys.length) throw new Error('Sélectionnez au moins un matériel.');
      const lock = await ref('lock').transaction(value => value === null ? id : undefined);
      if (!lock.committed && lock.snapshot.val() !== id) throw new Error('Un autre inventaire est déjà en cours.');
      // Freeze first, then read a server snapshot. All operational stock writes are denied by rules.
      const lines = {};
      for (const key of keys) {
        const s = (await db.ref('itc_data/stock/' + key).once('value')).val();
        if (!s || s.company_id !== company || C.operator(s.op) !== op) throw new Error('Matériel hors périmètre.');
        lines[key] = {label:s.label || key,theoretical:C.quantity(s.qty),type:s.type || ''};
      }
      await ref(`inventories/${id}`).update({lines,referenceAt:now(),status:'counting'});
      await log('Stock gelé et comptage démarré',id); return;
    }
    if (mode === 'counts') {
      const updates = {};
      for (const [key] of Object.entries(r.lines || {})) {
        if (isController() && data['count-'+key] !== '' && data['count-'+key] !== undefined) { updates[`lines/${key}/counted`] = C.quantity(data['count-'+key]); updates[`lines/${key}/note`] = data['note-'+key] || ''; }
        if (isManager() && data['manager-'+key] !== '' && data['manager-'+key] !== undefined) updates['managerCounts/'+key] = {qty:C.quantity(data['manager-'+key]),by:uid,at:now()};
      }
      if (!Object.keys(updates).length) throw new Error('Saisissez au moins un comptage.');
      await ref(`inventories/${id}`).update(updates); await log('Comptage enregistré par '+role(),id); return;
    }
    if (['response','decision','managerResponse'].includes(mode)) {
      if (!data.text.trim()) throw new Error('Réponse obligatoire.');
      await ref(`${kind}/${id}/${mode}`).set({text:data.text.trim(),by:uid,at:now()}); await log('Réponse / décision enregistrée',id); return;
    }
    if (mode === 'approve') {
      validateInventory(r);
      await ref(`inventories/${id}`).update({decision:{text:data.text,by:uid,at:now()},status:data.status});
      await log(data.status === 'approved' ? 'Régularisation approuvée' : 'Recomptage demandé',id); return;
    }
    if (mode === 'audit') {
      const checklist = Object.fromEntries(checks.map((title,i) => [i,{title,result:data['result-'+i],proof:data['proof-'+i]}]));
      await ref(`${kind}/${id}/checklist`).set(checklist); await log('Vérifications d’audit enregistrées',id); return;
    }
    if (mode === 'update') {
      if (r.source === 'transfer') {
        if (data.receivedQty === '') delete data.receivedQty;
        else data.receivedQty = C.quantity(data.receivedQty);
        if (data.receivedQty !== undefined && data.receivedQty !== r.sentQty && data.status === 'conform') throw new Error('Un transfert avec un écart doit être justifié ou signalé comme anomalie.');
      }
      if (data.status === 'closed') {
        if (!data.description.trim() || !data.evidence.trim()) throw new Error('La clôture nécessite une conclusion et une preuve.');
        if (kind === 'audits' && checks.some((_,i) => !r.checklist?.[i]?.result || r.checklist[i].result === 'Non vérifié')) throw new Error('Terminez tous les points de contrôle avant la clôture.');
        if (kind === 'actions' && !r.response) throw new Error('Le responsable doit fournir une preuve de réalisation.');
      }
      // Transaction detects a concurrent response or modification without overwriting it.
      const result = await ref(`${kind}/${id}`).transaction(current => current && current.status !== 'closed' ? {...current,...data} : undefined);
      if (!result.committed) throw new Error('Dossier déjà clôturé.');
      await log('Dossier mis à jour : '+(statuses[data.status] || data.status),id);
    }
  }
  function validateInventory(r) {
    const lines = Object.entries(r.lines || {});
    if (!lines.length || lines.some(([k,l]) => l.counted === undefined || !r.managerCounts?.[k])) throw new Error('Le contrôleur et le gestionnaire doivent compter chaque ligne.');
    if (!r.managerResponse?.text) throw new Error('Les observations du gestionnaire sont requises.');
    for (const [,line] of lines) C.quantity(line.counted);
  }
  function handle(action, data) {
    if (action === 'dashboard-stock') { if (!ops().includes(data.op)) return; op = data.op; state = summaries[op] || {}; detail = null; draw(); return; }
    if (action === 'back') { detail = null; draw(); return; }
    if (action === 'refresh') { draw(); return; }
    if (action === 'filter') { search = document.querySelector('[name="search"]').value; from = document.querySelector('[name="from"]').value; to = document.querySelector('[name="to"]').value; draw(); return; }
    if (action === 'clear') { search = ''; from = ''; to = ''; statusFilter = ''; draw(); return; }
    if (action === 'flow-tab') { flowTab = data.id; draw(); return; }
    if (action === 'print') { window.print(); return; }
    if (action === 'csv') { exportCSV(); return; }
    if (action === 'new-transfer') { detail={mode:'create',kind:'checks',source:'transfer'};draw();return; }
    if (action === 'mark-read') { run(()=>ref('preferences/'+uid).set({lastSeen:now()}));return; }
    if (action === 'download') {
      const attachment = state[detail.kind]?.[detail.id]?.attachments?.[data.id];
      if (!attachment || !['image/png','image/jpeg','application/pdf'].includes(attachment.type)) return;
      const bytes = Uint8Array.from(atob(attachment.data),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:attachment.type}));const a=document.createElement('a');a.href=url;a.download=attachment.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if (['new','linked','check'].includes(action)) { const sourceId = action === 'linked' ? detail.id : data.id; const source = action === 'linked' ? detail.kind : data.kind; detail = {mode:'create',kind:action === 'check' ? 'checks' : data.kind,sourceId,source}; draw(); return; }
    if (['open','material','movement'].includes(action)) { detail = {kind:data.kind,id:data.id,mode:action === 'open' ? null : action}; draw(); return; }
    run(async () => {
      const id = detail.id;
      const r = (await ref('inventories/'+id).once('value')).val();
      if (action === 'submit-inventory') {
        validateInventory(r);
        for (const [key,line] of Object.entries(r.lines)) if (line.counted !== line.theoretical) {
          const target=ref('anomalies/inventory_'+id+'_'+key);
          if (!(await target.once('value')).exists()) await target.set({title:'Écart inventaire : '+line.label,description:`Théorique : ${line.theoretical}. Compté : ${line.counted}. Écart : ${line.counted-line.theoretical}.`,status:'open',severity:'Moyenne',source:'inventories',sourceId:id,createdBy:uid,createdAt:now()});
        }
        await ref('inventories/'+id+'/status').set('review'); await log('Inventaire soumis pour approbation',id);
      }
      if (action === 'recount') { await ref('inventories/'+id+'/status').set('counting'); await log('Recomptage demandé par le contrôleur',id); }
      if (action === 'cancel-inventory') { await ref('inventories/'+id+'/status').set('cancelled'); if (state.lock === id) await ref('lock').remove(); await log('Inventaire annulé, stock libéré',id); }
      if (action === 'unlock') await ref('lock').remove();
      if (action === 'apply-inventory') {
        if (!isSupervisor() || r.createdBy === uid) throw new Error('Approbation indépendante requise.');
        validateInventory(r);
        for (const key of Object.keys(r.lines)) {
          await C.applyAdjustment(db.ref('itc_data/stock/'+key),r,key,id);
        }
        await ref('inventories/'+id+'/status').set('closed'); await ref('lock').remove(); await log('Régularisations appliquées et inventaire clôturé',id);
      }
    });
  }
  function exportCSV() {
    const list = ['inventories','audits','anomalies','actions'].flatMap(kind => filtered(rows(kind)).map(r => [labels[kind],r.id,r.title,statuses[r.status] || r.status,r.due || '',r.description || '']));
    const quote = v => '"' + String(v).replace(/^(\s*[=+@-])/, "'$1").replace(/"/g,'""') + '"';
    const content = '\uFEFF' + [['Type','Référence','Objet','Statut','Échéance','Conclusion'],...list].map(row => row.map(quote).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = 'controle-'+op+'-'+now().slice(0,10)+'.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function refreshStocks() {
    const selector = document.getElementById('ctl-op');
    if (!selector || !String(currentSectionId).startsWith('control-')) return;
    const available = ops();
    if (!op && available.length) { op = available[0]; subscribe(); return; }
    selector.innerHTML = available.map(value=>`<option ${value === op ? 'selected' : ''}>${e(value)}</option>`).join('');
  }
  window.StockControl = {enter,stop,reset,refreshStocks,isBusy:()=>busy};
})();
