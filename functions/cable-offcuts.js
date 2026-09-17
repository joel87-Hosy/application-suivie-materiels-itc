'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getDatabase}=require('firebase-admin/database');
const core=require('./cable-offcuts-core');
const validKey=value=>typeof value==='string' && /^[\p{L}\p{N}_-]{1,100}$/u.test(value);
exports.cableOffcuts=onCall({region:'europe-west1',timeoutSeconds:60},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Connexion requise.');
  const db=getDatabase(),uid=request.auth.uid;
  const profile=(await db.ref('auth_profiles/'+uid).get()).val();
  if(!profile?.is_active || !validKey(profile.company_id))throw new HttpsError('permission-denied','Compte inactif.');
  const company=profile.company_id;
  if((await db.ref('tenant_branding/'+company+'/status').get()).val()!=='active')throw new HttpsError('permission-denied','Entreprise inactive.');
  const users=(await db.ref('itc_data/users').orderByChild('company_id').equalTo(company).get()).val()||{};
  const user=Object.values(users).find(u=>u.uid===uid);
  // Older team accounts predate security scope maps; managedOps is not a
  // self-editable field and is the existing assignment source for those accounts.
  const assigned = Array.isArray(user?.managedOps) ? user.managedOps : [];
  const scopes = profile.controlScopes ?? Object.fromEntries(assigned.map(op=>[op==='ITC'?'ITC-B01':op,true]));
  const actor={...profile,controlScopes:scopes,uid,name:user?.name || user?.full_name || profile.role};
  const command=request.data || {};
  try {
    if(command.action==='overview') {
      const stock=(await db.ref('itc_data/stock').orderByChild('company_id').equalTo(company).get()).val()||{};
      const ops=new Set([...Object.values(stock).map(s=>s.op==='ITC'?'ITC-B01':s.op),...Object.keys(actor.controlScopes||{})]);
      // Existing empty stores remain visible after the last normal stock card is removed.
      if(core.globalView.has(actor.role))Object.keys((await db.ref('cable_offcuts/'+company).get()).val()||{}).forEach(op=>ops.add(op));
      const stores={};
      await Promise.all([...ops].filter(op=>validKey(op)&&core.canRead(actor,op)).map(async op=>{
        const state=(await db.ref('cable_offcuts/'+company+'/'+op).get()).val()||{};
        delete state.commands;
        if(actor.role==='Technicien') {
          for(const key of ['returns','requests'])state[key]=Object.fromEntries(Object.entries(state[key]||{}).filter(([,r])=>r.technicienUid===uid));
          state.events=Object.fromEntries(Object.entries(state.events||{}).filter(([,r])=>r.actorUid===uid));
        }
        stores[op]=state;
      }));
      const sources=[];
      if(actor.role==='Technicien') {
        const sorties=(await db.ref('itc_data/sorties').orderByChild('company_id').equalTo(company).get()).val()||{};
        for(const [key,s] of Object.entries(sorties))for(const [index,item] of (s.items||[]).entries()) {
          const material=Object.values(stock).find(m=>m.op===(item.op||s.op)&&m.label===item.label);
          const source=core.sourceFromSortie(s,{...item,type:item.type||material?.type},actor,key,index);
          if(source)sources.push(source);
        }
      }
      return {stores,sources};
    }
    if(!validKey(command.op)||!validKey(command.commandId)||!core.canRead(actor,command.op))throw Error('Stock non autorisé.');
    let source=null;
    if(command.action==='return'&&!command.issueId) {
      if(!validKey(command.sortieKey)||!Number.isInteger(command.itemIndex)||command.itemIndex<0)throw Error('Bon source obligatoire.');
      const sortie=(await db.ref('itc_data/sorties/'+command.sortieKey).get()).val();
      const item=sortie?.items?.[command.itemIndex];
      if(item) {
        const stock=(await db.ref('itc_data/stock').orderByChild('company_id').equalTo(company).get()).val()||{};
        const material=Object.values(stock).find(m=>m.op===(item.op||sortie.op)&&m.label===item.label);
        source=core.sourceFromSortie(sortie,{...item,type:item.type||material?.type},actor,command.sortieKey,command.itemIndex);
      }
    }
    const ref=db.ref('cable_offcuts/'+company+'/'+command.op),context={op:command.op,company,now:new Date().toISOString(),id:command.commandId,source};
    let failure;
    // Keep the SDK cache populated: an initially empty transaction cache must not
    // be mistaken for a missing return or lot.
    const keep=()=>{};ref.on('value',keep);
    let result;
    try {
      await ref.once('value');
      result=await ref.transaction(current=>{
        try{failure=null;return core.transition(current,command,actor,context);}catch(error){failure=error;return;}
      });
    } finally {ref.off('value',keep);}
    if(!result.committed)throw failure || Error('Opération interrompue, veuillez réessayer.');
    const state=result.snapshot.val();
    const notificationText={return:'Retour de câble à valider',request:'Demande de chute à valider',approveReturn:'Câble à réceptionner physiquement',approveRequest:'Chute à délivrer physiquement',receiveReturn:'Retour de câble réceptionné',issue:'Bon de sortie de chute disponible',rejectReturn:'Retour de câble refusé',rejectRequest:'Demande de chute refusée'}[command.action];
    if(notificationText) {
      const record=state.returns?.[command.target||command.commandId] || state.requests?.[command.target||command.commandId];
      const recipients=Object.values(users).filter(u=>u.is_active!==false && (
        ['return','request'].includes(command.action) ? ['Coordinateur','Coordinatrice'].includes(u.role) && (u.managedOps||[]).includes(command.op) :
        ['approveReturn','approveRequest'].includes(command.action) ? u.role==='Gestionnaire' && (u.managedOps||[]).includes(command.op) : u.uid===record?.technicienUid));
      const updates={};
      for(const u of recipients)if(u.uid)updates['itc_data/notifications/chute-'+command.commandId+'-'+u.uid]={company_id:company,userId:u.id,actorUid:uid,date:context.now,lu:false,stockOp:command.op,auditFlux:command.op,offcut:true,message:notificationText+' — CHUTES '+command.op+' — '+(record?.label||''),reference:record?.id||command.commandId};
      // The committed stock operation stays successful even if a notification fails.
      if(Object.keys(updates).length)await db.ref().update(updates).catch(error=>console.error('Offcut notification delivery',error.message));
    }
    return {ok:true};
  } catch(error) {throw new HttpsError('failed-precondition',error.message);}
});
