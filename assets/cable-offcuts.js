/* Dedicated cable remnants: all state changes are validated atomically by the server. */
(function(global) {
  'use strict';
  const status={COORD_PENDING:'À valider par le coordinateur',RECEPTION_PENDING:'À réceptionner physiquement',RECEIVED:'Réceptionné',ISSUE_PENDING:'À délivrer par le gestionnaire',ISSUED:'Sortie effectuée',REJECTED:'Refusé'};
  const actions={return:'Retour déclaré',approveReturn:'Retour validé par le coordinateur',receiveReturn:'Réception physique',manualEntry:'Entrée entrepôt',request:'Demande de sortie',approveRequest:'Demande validée',issue:'Sortie physique',rejectReturn:'Retour refusé',rejectRequest:'Demande refusée'};
  const roles=['Technicien','Coordinateur','Coordinatrice','Gestionnaire','Superviseur','DG','Contrôleur'];
  let env,container,data={stores:{},sources:[]},op='',busy=false,generation=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=value=>Object.values(value||{});
  const date=v=>v?new Date(v).toLocaleString('fr-FR'):'—';
  const quantity=v=>Number(v||0).toLocaleString('fr-FR',{maximumFractionDigits:2})+' m';
  const state=()=>data.stores[op]||{};
  const role=()=>env.profile()?.role;
  const call=async payload=>(await firebase.app().functions('europe-west1').httpsCallable('cableOffcuts')(payload)).data;
  const btn=(action,id,label)=>`<button type="button" data-action="${action}" data-id="${esc(id)}" class="px-3 py-2 rounded-lg bg-teal-700 text-white text-xs">${label}</button>`;
  const input=(name,label,type='text')=>`<label class="block text-sm">${label}<input name="${name}" type="${type}" ${type==='number'?'min="0.01" max="1000000" step="0.01"':''} maxlength="500" required class="block w-full border rounded-lg p-3 mt-1"></label>`;
  const table=(headers,body)=>`<div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead class="bg-slate-100"><tr>${headers.map(h=>`<th class="p-3">${h}</th>`).join('')}</tr></thead><tbody>${body.length?body.map(r=>`<tr class="border-b">${r.map(v=>`<td class="p-3 align-top">${v}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="p-4 text-slate-500">Aucun élément.</td></tr>`}</tbody></table></div>`;
  function setup(config){env=config;}
  function stop(){generation++;container=null;data={stores:{},sources:[]};op='';}
  async function enter(target){container=target;await refresh();}
  async function refresh(){
    if(!container)return;
    const token=++generation,target=container;
    target.innerHTML='<p class="p-6">Chargement des stocks de chutes…</p>';
    try{
      const result=await call({action:'overview'});
      if(token!==generation)return;
      data=result;if(!data.stores[op])op=Object.keys(data.stores).sort()[0]||'';
      render();
    }catch(e){if(token===generation){target.innerHTML=`<div class="p-6 text-red-700">Chargement impossible : ${esc(e.message)}<p class="mt-3">${btn('refresh','','Réessayer')}</p></div>`;bind();}}
  }
  function sourceOptions(){
    const sources=data.sources.filter(s=>s.op===op).map(s=>({...s,choice:s.key}));
    for(const r of rows(state().requests).filter(r=>r.status==='ISSUED'))sources.push({choice:'issue:'+r.id,key:'issue:'+r.id,issueId:r.id,label:r.label,reference:r.reference,issuedQty:r.qty});
    return sources.map(source=>({...source,remaining:Math.round((source.issuedQty-rows(state().returns).filter(r=>r.source.key===source.key&&r.status!=='REJECTED').reduce((sum,r)=>sum+r.qty,0))*100)/100})).filter(s=>s.remaining>0);
  }
  function form(action,title,fields){return `<form data-command="${action}" class="bg-white border rounded-2xl p-5 space-y-3"><h3 class="font-bold">${title}</h3>${fields}<button class="bg-teal-700 text-white rounded-lg px-4 py-3" type="submit">${action==='return'?'Transmettre au coordinateur':action==='request'?'Demander un bon de sortie':'Enregistrer la chute reçue'}</button></form>`;}
  function render(){
    if(!container)return;
    const s=state(),lots=rows(s.lots),returns=rows(s.returns).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),requests=rows(s.requests).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const manager=role()==='Gestionnaire',tech=role()==='Technicien',coord=['Coordinateur','Coordinatrice'].includes(role());
    const available=lots.filter(l=>l.qty>0);
    const controls=(r,kind)=>{
      if(coord&&r.status==='COORD_PENDING')return btn(kind==='returns'?'approveReturn':'approveRequest',r.id,'Valider')+' '+btn(kind==='returns'?'rejectReturn':'rejectRequest',r.id,'Refuser');
      if(manager&&r.status==='RECEPTION_PENDING'&&kind==='returns')return btn('receiveReturn',r.id,'Confirmer la réception physique')+' '+btn('rejectReturn',r.id,'Refuser');
      if(manager&&r.status==='ISSUE_PENDING'&&kind==='requests')return btn('issue',r.id,'Confirmer la sortie physique')+' '+btn('rejectRequest',r.id,'Refuser');
      return kind==='requests'&&r.status==='ISSUED'?btn('bon',r.id,'Bon de sortie PDF'):'';
    };
    const history=rows(s.events).sort((a,b)=>b.at.localeCompare(a.at));
    container.innerHTML=`<div class="space-y-6 p-4">
      <header class="bg-teal-800 text-white rounded-2xl p-6"><h2 class="text-xl font-black">Stocks de chutes de câbles</h2><p class="mt-2">Chaque lot représente une longueur de câble réutilisable en bon état. Les longueurs sont exprimées en mètres.</p><p class="mt-2">Retour : technicien → coordinateur → réception physique du gestionnaire. Réutilisation : demande → coordinateur → sortie physique.</p></header>
      <div class="flex gap-3 items-center flex-wrap"><label>Stock dédié <select id="chute-op" class="border rounded-lg p-3">${Object.keys(data.stores).sort().map(key=>`<option ${op===key?'selected':''} value="${esc(key)}">Chutes ${esc(key)}</option>`).join('')}</select></label>${btn('refresh','','Actualiser')}${btn('excel','','Rapport Excel')}${btn('pdf','','Rapport PDF')}</div>
      <p id="chute-message" role="status" class="text-sm text-teal-800"></p>
      ${!op?'<p>Aucun stock dédié accessible. Faites vérifier votre affectation.</p>':`
      <div class="bg-white rounded-2xl p-5 border"><h3 class="font-bold">Stock actuel — Chutes ${esc(op)}</h3><p class="text-2xl font-bold">${quantity(lots.reduce((sum,l)=>sum+Number(l.qty),0))}</p><p>${available.length} lot(s) disponible(s). Les lots restent séparés pour respecter la longueur de chaque chute.</p></div>
      ${manager?form('manualEntry','Entrée de chute déjà disponible dans l’entrepôt',input('label','Nom du câble')+input('qty','Longueur de cette chute (m)','number')+input('motif','Motif / origine de la chute')):''}
      ${tech?`<div class="grid md:grid-cols-2 gap-4">${form('return','Retour de câble en bon état',`<label class="block text-sm">Câble reçu / bon d’origine<select name="source" required class="w-full border rounded-lg p-3"><option value="">Choisir un câble reçu</option>${sourceOptions().map(source=>`<option value="${esc(source.choice)}">${esc(source.label)} — ${esc(source.reference)} — restant retournable : ${quantity(source.remaining)}</option>`).join('')}</select></label>`+input('qty','Distance restante à retourner (m)','number')+input('motif','Motif du retour'))}${form('request','Réutiliser une chute : demande de bon de sortie',`<label class="block text-sm">Lot de provenance<select name="lotId" required class="w-full border rounded-lg p-3"><option value="">Choisir un lot</option>${available.map(l=>`<option value="${esc(l.id)}">${esc(l.label)} — ${quantity(l.qty)} — ${esc(l.id)}</option>`).join('')}</select></label>`+input('qty','Longueur demandée (m)','number')+input('motif','Motif / chantier'))}</div>`:''}
      <section class="bg-white rounded-2xl p-5 border"><h3 class="font-bold mb-3">Lots de chutes et provenance</h3>${table(['Câble / type','Lot','Stock actuel','Origine / bon source','Réception'],lots.map(l=>[esc(l.label)+'<br>'+esc(l.materialType),esc(l.id),quantity(l.qty),esc(l.origin)+'<br>'+esc(l.sourceReference)+(l.parentLotId?'<br>Lot précédent : '+esc(l.parentLotId):''),esc(date(l.createdAt))]))}</section>
      <section class="bg-white rounded-2xl p-5 border"><h3 class="font-bold mb-3">Retours de câbles</h3>${table(['Câble / technicien','Longueur / motif','Bon d’origine','État / validations','Action'],returns.map(r=>[esc(r.label)+'<br>'+esc(r.technicienName),quantity(r.qty)+'<br>'+esc(r.motif),esc(r.source.reference),esc(status[r.status])+'<br>'+stamps(r),controls(r,'returns')]))}</section>
      <section class="bg-white rounded-2xl p-5 border"><h3 class="font-bold mb-3">Demandes et bons de sortie — provenance stock de chutes</h3>${table(['Câble / technicien','Longueur / chantier','Lot de provenance','État / validations','Action'],requests.map(r=>[esc(r.label)+'<br>'+esc(r.technicienName),quantity(r.qty)+'<br>'+esc(r.motif),esc(r.lotId),esc(status[r.status])+'<br>'+stamps(r),controls(r,'requests')]))}</section>
      <section class="bg-white rounded-2xl p-5 border"><h3 class="font-bold mb-3">Historique des flux — Chutes ${esc(op)}</h3>${table(['Date','Action / auteur','Câble / longueur','Variation du stock','Lot / référence / origine'],history.map(e=>[esc(date(e.at)),esc(actions[e.action])+'<br>'+esc(e.actorName),esc(e.label)+'<br>'+quantity(e.qty),quantity(e.delta),esc(e.lotId||'—')+'<br>'+esc(e.reference)+'<br>'+esc(e.sourceReference||'')]))}</section>`}</div>`;
    bind();
  }
  function stamps(r){return ['coordination','reception','delivery','rejection'].filter(k=>r[k]).map(k=>esc(r[k].name)+' — '+esc(date(r[k].at))+(r[k].reason?' : '+esc(r[k].reason):'')).join('<br>');}
  function bind(){
    container.onchange=e=>{if(e.target.id==='chute-op'&&!busy){op=e.target.value;render();}};
    container.onsubmit=async e=>{const form=e.target.closest('[data-command]');if(!form)return;e.preventDefault();if(!form.reportValidity())return;
      const payload=Object.fromEntries(new FormData(form));payload.action=form.dataset.command;if(payload.qty)payload.qty=Number(payload.qty);
      if(payload.action==='return'){
        const source=sourceOptions().find(s=>s.choice===payload.source);if(!source)return;
        Object.assign(payload,source.issueId?{issueId:source.issueId}:{sortieKey:source.sortieKey,itemIndex:source.itemIndex});delete payload.source;
      }
      await mutate(payload,form);
    };
    container.onclick=async e=>{const button=e.target.closest('[data-action]');if(!button||busy)return;
      const action=button.dataset.action,id=button.dataset.id;
      if(action==='refresh')return refresh();if(action==='excel')return exportExcel();if(action==='pdf')return exportPdf();if(action==='bon')return exportPdf(id);
      let reason;
      if(action.startsWith('reject')){reason=global.prompt('Motif du refus');if(!reason?.trim())return;}
      if(['receiveReturn','issue'].includes(action)&&!global.confirm(action==='receiveReturn'?'Confirmer que la longueur déclarée a été reçue physiquement, contrôlée et est en bon état ?':'Confirmer la remise physique de cette longueur au technicien ?'))return;
      await mutate({action,target:id,...(reason?{reason}:{})},button);
    };
  }
  async function mutate(payload,element){
    if(busy)return;busy=true;const token=generation;
    // Retrying the same command after a network timeout must never receive or issue twice.
    const signature=JSON.stringify(payload);
    if(element.dataset.signature!==signature){element.dataset.commandId=crypto.randomUUID();element.dataset.signature=signature;}
    container.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);
    try{await call({...payload,op,commandId:element.dataset.commandId});if(token===generation){await refresh();const message=container?.querySelector('#chute-message');if(message)message.textContent='Opération enregistrée et tracée.';}}
    catch(e){if(token===generation){const message=container.querySelector('#chute-message');if(message)message.textContent=e.message;}}
    finally{busy=false;container?.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=false);}
  }
  function reportRows(){return rows(state().events).sort((a,b)=>a.at.localeCompare(b.at)).map(e=>({'Date':date(e.at),'Stock de provenance':'CHUTES '+op,'Action':actions[e.action],'Câble':e.label,'Longueur (m)':e.qty,'Variation (m)':e.delta,'Lot':e.lotId||'','Référence':e.reference,'Origine':e.sourceReference||'','Auteur':e.actorName}));}
  function exportExcel(){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(reportRows()),'Flux chutes');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows(state().lots).map(l=>({'Stock':'CHUTES '+op,'Lot':l.id,'Câble':l.label,'Type':l.materialType,'Disponible (m)':l.qty,'Longueur initiale (m)':l.initialQty,'Origine':l.origin,'Bon source':l.sourceReference,'Lot précédent':l.parentLotId||'','Réception':date(l.createdAt)}))),'Stock actuel');XLSX.writeFile(wb,'Chutes_'+op+'.xlsx');}
  function exportPdf(id){
    const doc=new global.jspdf.jsPDF();const request=id?state().requests?.[id]:null;
    if(id&&request?.status!=='ISSUED')return;
    doc.setFontSize(14);doc.text(request?'BON DE SORTIE — STOCK DE CHUTES':'RAPPORT — STOCK DE CHUTES',14,18);
    doc.setFontSize(10);doc.text('Provenance : CHUTES '+op,14,27);
    if(request){
      const lines=[request.reference,'Technicien : '+request.technicienName,'Câble : '+request.label,'Type : '+request.materialType,'Longueur délivrée : '+quantity(request.qty),'Lot : '+request.lotId,'Origine : '+request.sourceReference,'Motif / chantier : '+request.motif,'Coordination : '+request.coordination.name+' — '+date(request.coordination.at),'Réception / sortie gestionnaire : '+request.delivery.name+' — '+date(request.delivery.at)];
      doc.autoTable({startY:34,head:[['Traçabilité du bon']],body:lines.map(line=>[line]),styles:{fontSize:9}});
    }else{
      doc.text('Stock actuel : '+quantity(rows(state().lots).reduce((sum,l)=>sum+l.qty,0)),14,34);
      doc.autoTable({startY:40,head:[['Date','Action','Câble','Variation (m)','Lot / référence / origine']],body:rows(state().events).sort((a,b)=>a.at.localeCompare(b.at)).map(e=>[date(e.at),actions[e.action],e.label,String(e.delta),[e.lotId,e.reference,e.sourceReference].filter(Boolean).join('\n')]),styles:{fontSize:7}});
    }
    doc.save((request?request.reference:'Rapport_chutes_'+op)+'.pdf');
  }
  global.CableOffcuts={setup,enter,stop,isBusy:()=>busy,roles};
})(window);
