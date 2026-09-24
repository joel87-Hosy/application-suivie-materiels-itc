(function(global) {
  'use strict';
  let env, busy=false, generation=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const op=v=>global.ControlCore.operator(v);
  const allowed=()=>env.profile()?.role==='Gestionnaire';
  const stocks=()=>global.ControlCore.managerStocks(env.profile());
  const destinations=()=>global.ControlCore.transferDestinations(env.profile());
  async function execute(args) {
    const {data,error}=await env.client().rpc('manager_stock_operation',args);
    if(error)throw error;
    return data;
  }
  async function edit(item) {
    if(busy)return;
    if(!allowed()||!stocks().includes(op(item.op)))return global.alert('Stock hors de votre affectation.');
    const name=global.prompt("MODIFIER LE NOM DE L’ARTICLE :",item.label);if(name===null)return;
    const raw=global.prompt('MODIFIER LA QUANTITÉ EN STOCK :',String(item.qty));if(raw===null)return;
    const qty=Number(raw);
    if(!name.trim()||!raw.trim()||!Number.isFinite(qty)||qty<0)return global.alert('Renseignez un nom et une quantité positive ou nulle.');
    const reason=global.prompt('Motif de la correction (conservé dans la traçabilité) :');if(!reason?.trim())return;
    if(!global.confirm(`Enregistrer ${name.trim()} : ${qty} unités ?`))return;
    busy=true;
    try {
      await execute({operation_id:global.crypto.randomUUID(),stock_key:item._dbKey,expected:item,new_label:name.trim(),quantity:qty,destination:null,reason,signature:null,service:null});
      await env.refresh();busy=false;env.navigate('cockpit');global.alert('Modification enregistrée et tracée.');
    }catch(error){global.alert(error.message);}finally{busy=false;}
  }
  async function remove(item) {
    if(busy)return;
    if(!allowed()||!stocks().includes(op(item.op)))return global.alert('Stock hors de votre affectation.');
    if(!global.confirm(`Supprimer définitivement « ${item.label} » du stock ${item.op} ? Quantité actuelle : ${item.qty}. La fiche et sa quantité seront retirées ; une trace sera conservée dans l’audit.`))return;
    busy=true;
    try {
      const {error}=await env.client().rpc('delete_manager_stock_item',{operation_id:global.crypto.randomUUID(),stock_key:item._dbKey,expected:item});
      if(error)throw error;
      await env.refresh();env.navigate('cockpit');global.alert('Article supprimé du stock.');
    }catch(error){global.alert(error.code==='PGRST202'?'La suppression nécessite la migration Supabase 202609240003_delete_manager_stock_item.sql.':error.message);}
    finally{busy=false;}
  }
  function pdf(bon) {
    const doc=new global.jspdf.jsPDF();
    doc.setFontSize(16);doc.text('BON DE SORTIE — TRANSFERT',14,20);
    doc.setFontSize(10);
    const lines=[`Référence : ${bon.ref}`,`Date : ${new Date(bon.date).toLocaleString('fr-FR')}`,`Stock source : ${bon.op}`,`Stock destinataire : ${bon.destination}`,`Gestionnaire : ${bon.byName}`,`Service : ${bon.serviceAbbreviation}`];
    doc.text(lines,14,30);
    doc.autoTable({startY:65,head:[['Matériel','Quantité','Source avant / après','Destination avant / après']],body:[[bon.before.label,String(bon.quantity),`${bon.before.qty} / ${bon.after.qty}`,`${bon.destinationBeforeQty} / ${bon.destinationAfterQty}`]]});
    let y=doc.lastAutoTable.finalY+12;
    for(const text of [`Motif : ${bon.reason}`,`Signature du gestionnaire : ${bon.signature}`,`Identifiant de traçabilité : ${bon.id}`]) {
      for(const line of doc.splitTextToSize(text,180)){if(y>280){doc.addPage();y=20;}doc.text(line,14,y);y+=6;}
    }
    doc.save(`${bon.ref}.pdf`);
  }
  async function enter(container) {
    const token=++generation;
    if(!allowed()){container.textContent='Accès réservé au gestionnaire.';return;}
    container.innerHTML='<p class="p-6">Chargement des stocks…</p>';
    try {
      await env.refresh();if(token!==generation)return;
      const ops=stocks(),targets=destinations(),items=(env.data().stock||[]).filter(i=>ops.includes(op(i.op)));
      const canTransfer=ops.some(source=>targets.some(target=>target!==source));
      const history=(env.data().sorties||[]).filter(b=>b.type==='TRANSFERT'&&(ops.includes(op(b.op))||ops.includes(op(b.destination)))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      const options=ops.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
      container.innerHTML=`<div class="p-4 space-y-5"><h2 class="text-xl font-bold">Transferts de matériel</h2><p>Le transfert débite votre stock source, crédite le destinataire et génère un bon de sortie avec les deux mouvements et votre signature.</p>${ops.includes('ITC-B02')?'<p class="bg-blue-50 p-3 rounded-xl">Bouaké, Yamoussoukro et San-Pédro : consultation et alimentation par transfert. Seul le gestionnaire affecté à chaque stock peut en modifier les articles.</p>':''}<button id="transfer-refresh" class="border p-3 rounded-xl">Actualiser</button><form class="bg-white p-5 rounded-2xl space-y-4">
        <label class="block">Stock source<select name="source" class="border p-3 w-full">${options}</select></label>
        <label class="block">Stock destinataire<select name="destination" class="border p-3 w-full" required></select></label>
        <label class="block">Article<select name="article" class="border p-3 w-full" required></select></label>
        <label class="block">Quantité<input name="quantity" type="number" min="0.001" step="any" required class="border p-3 w-full"></label>
        <label class="block">Service<select name="service" class="border p-3 w-full"><option>B2B</option><option>DEP</option><option>MAIN</option></select></label>
        <label class="block">Motif<textarea name="reason" maxlength="1000" required class="border p-3 w-full"></textarea></label>
        <label class="block">Signature du gestionnaire<input name="signature" maxlength="500" required value="${esc(env.profile()?.name)}" class="border p-3 w-full"></label>
        <p role="status" id="transfer-status"></p><button type="submit" class="bg-indigo-700 text-white rounded-xl p-3" ${!canTransfer?'disabled':''}>Confirmer le transfert et créer le bon</button>
        ${!canTransfer?'<p>Aucune destination de transfert disponible.</p>':''}</form>
        <section class="bg-white p-5 rounded-2xl"><h3 class="font-bold">Historique et bons de sortie</h3>${history.map((b,i)=>`<div class="border-b py-4"><b>${esc(b.ref)}</b><p>${esc(b.op)} → ${esc(b.destination)} · ${esc(b.before.label)} · ${esc(b.quantity)} unités</p><p>${esc(new Date(b.date).toLocaleString('fr-FR'))} · ${esc(b.byName)} · ${esc(b.reason)}</p><p>Source : ${esc(b.before.qty)} → ${esc(b.after.qty)} ; destination : ${esc(b.destinationBeforeQty)} → ${esc(b.destinationAfterQty)}</p><button data-bon="${i}" class="border p-2 rounded-lg">Télécharger le bon PDF</button></div>`).join('')||'<p>Aucun transfert.</p>'}</section></div>`;
      const form=container.querySelector('form'),fields=form.elements;
      const fill=()=>{
        fields.destination.innerHTML=targets.filter(o=>o!==fields.source.value).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
        fields.article.innerHTML=items.filter(i=>op(i.op)===fields.source.value&&Number(i.qty)>0).map(i=>`<option value="${esc(i._dbKey)}">${esc(i.label)} — ${esc(i.qty)} disponibles</option>`).join('');
      };
      fields.source.onchange=fill;fill();
      container.querySelector('#transfer-refresh').onclick=()=>{if(!busy)enter(container);};
      container.querySelectorAll('[data-bon]').forEach(b=>b.onclick=()=>pdf(history[Number(b.dataset.bon)]));
      let operationId=global.crypto.randomUUID(),attempt=null;
      form.onsubmit=async event=>{
        event.preventDefault();if(busy)return;
        const item=items.find(i=>i._dbKey===fields.article.value),quantity=Number(fields.quantity.value);
        if(!item||!Number.isFinite(quantity)||quantity<=0||quantity>Number(item.qty))return global.alert('Quantité invalide ou stock insuffisant.');
        if(!targets.includes(fields.destination.value)||fields.destination.value===op(item.op))return global.alert('Choisissez un stock destinataire autorisé.');
        if(!global.confirm('Confirmer le transfert physique et la création du bon de sortie ?'))return;
        const args={stock_key:item._dbKey,expected:item,new_label:null,quantity,destination:fields.destination.value,reason:fields.reason.value.trim(),signature:fields.signature.value.trim(),service:fields.service.value};
        const fingerprint=JSON.stringify(args);if(attempt&&attempt!==fingerprint)operationId=global.crypto.randomUUID();attempt=fingerprint;
        busy=true;form.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);
        try{await execute({...args,operation_id:operationId});await enter(container);}
        catch(error){container.querySelector('#transfer-status').textContent=error.message;}
        finally{busy=false;form.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=false);}
      };
      env.readNotifications?.('transferts-stocks');
    }catch(error){if(token===generation)container.textContent=error.message;}
  }
  global.ManagerStock={setup:config=>{env=config;},edit,remove,enter,pdf,isBusy:()=>busy,stop:()=>{generation++;}};
})(window);
