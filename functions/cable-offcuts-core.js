'use strict';
const crypto = require('node:crypto');
const viewers = new Set(['Technicien','Coordinateur','Coordinatrice','Gestionnaire','Superviseur','DG','Contrôleur','SUPER_ADMIN']);
const globalView = new Set(['Superviseur','DG','Contrôleur','SUPER_ADMIN']);
const coordinators = new Set(['Coordinateur','Coordinatrice']);
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const isCable = row => /CABLE|BOBINE|JARRETIERE|CORDON OPTIQUE/.test(normalize(row.label)+' '+normalize(row.materialType || row.type));
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function metres(value) {
  const n = Number(value);
  requireThat(Number.isFinite(n) && n > 0 && n <= 1000000 && Math.abs(n*100-Math.round(n*100)) < 1e-7, 'Longueur invalide : mètres positifs, deux décimales maximum.');
  return Math.round(n*100)/100;
}
const round = n => Math.round(n*100)/100;
function text(value, name, max=500) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, name+' obligatoire ou trop long.');
  return value.trim();
}
function canRead(profile, op) { return viewers.has(profile.role) && (globalView.has(profile.role) || profile.controlScopes?.[op] === true); }
function ownSource(source, actor) {
  return source.technicienUid === actor.uid || source.demandeurUid === actor.uid ||
    (actor.user_id != null && [source.technicienId,source.demandeurOriginalId].some(id=>id != null && String(id) === String(actor.user_id))) ||
    (!!actor.name && normalize(source.tech) === normalize(actor.name));
}
function sourceFromSortie(sortie, item, actor, key, index) {
  if (!sortie || sortie.company_id !== actor.company_id || !ownSource(sortie,actor)) return null;
  const rawOp = item.op || sortie.op;
  const op = rawOp === 'ITC' ? 'ITC-B01' : rawOp;
  if (!canRead(actor,op) || !isCable(item)) return null;
  const qty = Number(item.qty);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if(typeof item.label!=='string'||!item.label.trim())return null;
  return {key:'sortie:'+key+':'+index,kind:'sortie',sortieKey:key,itemIndex:index,op,label:item.label,materialType:item.type || 'CÂBLE',issuedQty:qty,reference:sortie.ref || sortie.id || key,issuedAt:sortie.date || ''};
}
function transition(current, command, actor, context) {
  const {op, company, now, id, source} = context;
  requireThat(actor.is_active === true && actor.company_id === company && canRead(actor,op),'Accès refusé à ce stock de chutes.');
  const state = structuredClone(current || {lots:{},returns:{},requests:{},events:{},commands:{}});
  for (const field of ['lots','returns','requests','events','commands']) state[field] ||= {};
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(command)).digest('hex');
  if (state.commands[id]) {
    requireThat(state.commands[id].uid === actor.uid && state.commands[id].fingerprint === fingerprint,'Identifiant de commande déjà utilisé.');
    return state;
  }
  const stamp = {uid:actor.uid,name:actor.name || actor.role,at:now};
  const event = {id,at:now,actorUid:actor.uid,actorName:stamp.name,company_id:company,op,stockKind:'CHUTE',action:command.action};
  const manager = () => requireThat(actor.role === 'Gestionnaire','Réception et sortie réservées au gestionnaire dédié.');
  const coord = () => requireThat(coordinators.has(actor.role),'Validation réservée au coordinateur dédié.');
  const target = (collection) => { const row=state[collection][command.target];requireThat(row,'Dossier introuvable.');return row; };
  const lotFor = key => {const lot=state.lots[key];requireThat(lot,'Lot de chute introuvable.');return lot;};
  if (command.action === 'return') {
    requireThat(actor.role === 'Technicien','Retour réservé au technicien.');
    const qty=metres(command.qty), motif=text(command.motif,'Motif');
    let origin=source;
    if(command.issueId) {
      const issue=state.requests[command.issueId];
      requireThat(issue?.status === 'ISSUED' && issue.technicienUid === actor.uid,'Bon de chute non délivré à ce technicien.');
      origin={key:'issue:'+command.issueId,kind:'chute',op,label:issue.label,materialType:issue.materialType,issuedQty:issue.qty,reference:issue.reference,lotId:issue.lotId};
    }
    requireThat(origin && origin.op === op && isCable(origin),'Choisissez le câble reçu sur un bon de sortie.');
    const reserved=Object.values(state.returns).filter(r=>r.source.key===origin.key && r.status!=='REJECTED').reduce((sum,r)=>sum+r.qty,0);
    requireThat(round(qty+reserved)<=origin.issuedQty,'La longueur retournée dépasse la longueur délivrée encore retournable.');
    state.returns[id]={id,label:origin.label,materialType:origin.materialType,qty,unit:'m',motif,condition:'BON ETAT',source:origin,status:'COORD_PENDING',technicienUid:actor.uid,technicienName:stamp.name,createdAt:now};
    Object.assign(event,{reference:id,label:origin.label,qty,delta:0,sourceReference:origin.reference});
  } else if (command.action === 'approveReturn') {
    coord();const r=target('returns');requireThat(r.status==='COORD_PENDING','Retour déjà traité.');r.status='RECEPTION_PENDING';r.coordination=stamp;
    Object.assign(event,{reference:r.id,label:r.label,qty:r.qty,delta:0});
  } else if (command.action === 'receiveReturn') {
    manager();const r=target('returns');requireThat(r.status==='RECEPTION_PENDING' && r.coordination,'Validation du coordinateur requise avant réception physique.');
    r.status='RECEIVED';r.reception=stamp;r.lotId='return-'+r.id;
    state.lots[r.lotId]={id:r.lotId,label:r.label,materialType:r.materialType,qty:r.qty,initialQty:r.qty,unit:'m',origin:'RETOUR TERRAIN',sourceReturnId:r.id,sourceReference:r.source.reference,parentLotId:r.source.lotId || null,createdAt:now,receivedBy:stamp};
    Object.assign(event,{reference:r.id,lotId:r.lotId,label:r.label,qty:r.qty,delta:r.qty,sourceReference:r.source.reference});
  } else if (command.action === 'manualEntry') {
    manager();const qty=metres(command.qty),label=text(command.label,'Nom du câble',150),motif=text(command.motif,'Motif / origine');
    state.lots[id]={id,label,materialType:'CÂBLE',qty,initialQty:qty,unit:'m',origin:'SAISIE ENTREPÔT',sourceReference:motif,createdAt:now,receivedBy:stamp};
    Object.assign(event,{reference:id,lotId:id,label,qty,delta:qty,sourceReference:motif});
  } else if (command.action === 'request') {
    requireThat(actor.role==='Technicien','Demande réservée au technicien.');const lot=lotFor(command.lotId),qty=metres(command.qty),motif=text(command.motif,'Motif / chantier');
    requireThat(qty<=lot.qty,'Longueur demandée supérieure à la chute disponible.');
    state.requests[id]={id,lotId:lot.id,label:lot.label,materialType:lot.materialType,qty,unit:'m',motif,stockKind:'CHUTE',sourceReference:lot.sourceReference,technicienUid:actor.uid,technicienName:stamp.name,status:'COORD_PENDING',createdAt:now};
    Object.assign(event,{reference:id,lotId:lot.id,label:lot.label,qty,delta:0});
  } else if (command.action === 'approveRequest') {
    coord();const r=target('requests');requireThat(r.status==='COORD_PENDING','Demande déjà traitée.');requireThat(lotFor(r.lotId).qty>=r.qty,'Chute devenue insuffisante.');r.status='ISSUE_PENDING';r.coordination=stamp;
    Object.assign(event,{reference:r.id,lotId:r.lotId,label:r.label,qty:r.qty,delta:0});
  } else if (command.action === 'issue') {
    manager();const r=target('requests');requireThat(r.status==='ISSUE_PENDING' && r.coordination,'Validation du coordinateur requise.');const lot=lotFor(r.lotId);
    requireThat(lot.qty>=r.qty,'Chute insuffisante : actualisez le stock.');lot.qty=round(lot.qty-r.qty);r.status='ISSUED';r.delivery=stamp;r.reference='BS-CHUTE-'+id;
    Object.assign(event,{reference:r.reference,requestId:r.id,lotId:r.lotId,label:r.label,qty:r.qty,delta:-r.qty,sourceReference:lot.sourceReference});
  } else if (command.action === 'rejectReturn' || command.action === 'rejectRequest') {
    const r=target(command.action==='rejectReturn'?'returns':'requests');
    if(r.status==='COORD_PENDING')coord();else {manager();requireThat(['RECEPTION_PENDING','ISSUE_PENDING'].includes(r.status),'Dossier déjà traité.');}
    r.status='REJECTED';r.rejection={...stamp,reason:text(command.reason,'Motif du refus')};Object.assign(event,{reference:r.id,label:r.label,qty:r.qty,delta:0});
  } else throw Error('Action inconnue.');
  state.events[id]=event;state.commands[id]={uid:actor.uid,fingerprint,at:now};
  return state;
}
module.exports={canRead,globalView,isCable,sourceFromSortie,transition,metres};
