(function(global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roles = ['Validateur','Validatrice'];
  let env, busy = false, generation = 0;
  const enabled = () => env?.profile()?.validatorWorkflowEnabled === true;
  const isValidator = () => roles.includes(env?.profile()?.role);
  const rpc = async (name, args) => {const {data,error} = await env.client().rpc(name,args); if(error) {if(error.code==='PGRST202') throw new Error('La base doit être mise à jour : appliquez la migration 202609240001_repair_rejected_bon_actions.sql dans Supabase, puis réessayez.'); throw error;} return data;};
  const op = value => String(value || '').trim().toUpperCase() === 'ITC' ? 'ITC-B01' : String(value || '').trim().toUpperCase();
  const covers = request => Array.isArray(request?.items) && request.items.length > 0 && request.items.every(item => env?.profile()?.controlScopes?.[op(item.op || request.op)] === true);
  function setup(config) {env=config;}
  function menu() {
    let element = document.getElementById('menu-validator');
    if (!element) {
      element = document.createElement('div'); element.id='menu-validator';
      element.innerHTML='<button type="button" class="w-full text-left p-3 rounded-xl bg-indigo-800 text-white font-bold">Validation des bons</button>';
      element.firstChild.onclick=()=>env.navigate('validation-bons');
      element.firstChild.dataset.notificationSection='validation-bons';
      document.getElementById('menu-cockpit')?.before(element);
    }
    element.classList.toggle('hidden',!isValidator());
  }
  function trace(request) {
    const decision=request.validatorDecision;
    return decision ? `${decision.approved?'Validé':'Refusé'} par ${decision.name || 'Validateur'} le ${new Date(decision.at).toLocaleString('fr-FR')}${decision.reason?' — '+decision.reason:''}${request.assignedGestionnaireName?' · Gestionnaire : '+request.assignedGestionnaireName:''}` : '';
  }
  function corrections(request) {
    return (request.correctionHistory||[]).map(c=>`<div class="border-l-4 border-amber-500 p-3 my-2"><p>Refus : ${esc(c.before?.validatorDecision?.reason)}</p><p>Correction par ${esc(c.name)} le ${esc(new Date(c.at).toLocaleString('fr-FR'))} : ${esc(c.note)}</p><p>Avant : ${esc((c.before?.items||[]).map(i=>`${i.label} : ${i.qty}`).join(', '))}</p><p>Après : ${esc((c.afterItems||[]).map(i=>`${i.label} : ${i.qty}`).join(', '))}</p></div>`).join('');
  }
  async function enter(container) {
    const token=++generation;
    if(!isValidator()) {container.textContent='Accès réservé aux validateurs.';return;}
    container.innerHTML='<p class="p-6">Chargement des bons…</p>';
    try {
      await env.refresh();
      const managers=await rpc('workflow_managers',{});
      if(!container.isConnected||token!==generation)return;
      const requests=(env.data().demandes||[]).filter(r=>r.status==='EN ATTENTE VALIDATEUR' && covers(r));
      const renewals=(env.data().demandes||[]).filter(r=>r.status==='EN ATTENTE GESTIONNAIRE' && r.bonRenewalRequestedAt && covers(r) && r.validatorDecision?.uid===(env.uid?.()||env.profile()?.uid));
      const history=(env.data().demandes||[]).filter(r=>r.validatorDecision && covers(r)).sort((a,b)=>b.validatorDecision.at.localeCompare(a.validatorDecision.at));
      container.innerHTML=`<div class="space-y-5 p-4"><header class="bg-indigo-800 text-white p-6 rounded-2xl"><h2 class="text-xl font-bold">Validation des bons</h2><p>${requests.length} bon(s) à traiter. Une validation transmet le bon au gestionnaire dédié ; le stock sera débité à la remise physique.</p><button type="button" id="validation-refresh" class="border rounded-lg p-2 mt-3">Actualiser les bons</button></header>
        <p class="font-bold">Bureau de validation : ${esc(env.profile()?.validationBureau || 'Non affecté')} · Stocks : ${esc(Object.keys(env.profile()?.controlScopes || {}).filter(key=>env.profile().controlScopes[key]===true).join(', ') || 'Aucun')}</p>
        ${enabled()?'':'<p>Le nouveau circuit est en cours de préparation.</p>'}
        <p role="status" id="validation-message"></p>
        ${renewals.length?`<section class="bg-amber-50 border border-amber-300 rounded-2xl p-5"><h3 class="font-bold">Bons expirés à confirmer (${renewals.length})</h3><p>Une confirmation autorise la récupération pendant 24 heures supplémentaires. La date de création et les articles restent conservés.</p>${renewals.map((r,index)=>`<form data-renewal="${index}" class="bg-white rounded-xl p-4 my-3 space-y-3"><b>${esc(r.ref||r.id)} · ${esc(r.demandeurName||r.tech)}</b><p>Créé le ${esc(global.BonScanner.date(r.bonCreatedAt))} · Expiré le ${esc(global.BonScanner.date(r.bonValidUntil))}</p><p>Gestionnaire : ${esc(r.assignedGestionnaireName)}</p><ul>${(r.items||[]).map(i=>`<li>${esc(i.label)} : ${esc(i.qty)} · ${esc(i.op||r.op)}</li>`).join('')}</ul><label class="block">Observation obligatoire<textarea name="reason" maxlength="1000" required class="border p-3 w-full"></textarea></label><button type="submit" value="approve" class="bg-green-700 text-white p-3 rounded-xl">Confirmer pour 24 heures</button><button type="submit" value="reject" class="bg-red-700 text-white p-3 rounded-xl">Refuser la remise</button></form>`).join('')}</section>`:''}
        ${requests.map((r,index)=>{
          const ops=[...new Set((r.items||[]).map(i=>op(i.op||r.op)))];
          const eligible=managers.filter(m=>ops.every(o=>m.scopes?.[o]===true));
          return `<form data-index="${index}" class="bg-white border rounded-2xl p-5 space-y-3"><h3 class="font-bold">${esc(r.ref||r.id)} — ${esc(r.demandeurName||r.tech||r.createdBy)}</h3><p>${esc(r.motif||'')} · ${esc(ops.join(', '))}</p>
            <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr><th class="text-left">Stock</th><th class="text-left">Matériel</th><th class="text-right">Quantité</th></tr></thead><tbody>${(r.items||[]).map(i=>`<tr><td>${esc(op(i.op||r.op))}</td><td>${esc(i.label)}</td><td class="text-right">${esc(i.qty)}</td></tr>`).join('')}</tbody></table></div>
            ${corrections(r)}
            ${r.coordinationSignatureText?`<p>Coordination : ${esc(r.coordinationSignatureText)}</p>`:''}
            <label class="block">Gestionnaire dédié<select name="manager" class="border p-3 rounded-lg w-full"><option value="">Choisir le gestionnaire</option>${eligible.map(m=>`<option value="${esc(m.uid)}" ${r.assignedGestionnaireUid===m.uid||eligible.length===1?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
            ${eligible.length?'':'<p class="text-amber-800">Aucun gestionnaire ne couvre tous les stocks de ce bon. Contactez le superviseur pour corriger les affectations avant de traiter ce bon.</p>'}
            <label class="block">Observation / motif du refus<textarea name="reason" maxlength="1000" class="border p-3 rounded-lg w-full"></textarea></label>
            <button type="submit" name="decision" value="approve" class="bg-green-700 text-white p-3 rounded-lg">Valider et transmettre</button>
            <button type="submit" name="decision" value="reject" class="bg-red-700 text-white p-3 rounded-lg">Refuser et retourner pour correction</button></form>`;
        }).join('') || '<p>Aucun bon en attente de validation.</p>'}
        <section class="bg-white border p-5 rounded-2xl"><h3 class="font-bold">Décisions et suivi</h3>${history.map(r=>`<div class="border-b py-3"><b>${esc(r.ref||r.id)}</b> — ${esc(r.status)}<p>${esc(trace(r))}</p>${corrections(r)}${r.validatedAt?`<p>Sortie physique : ${esc(r.validatedBy)} · ${esc(new Date(r.validatedAt).toLocaleString('fr-FR'))}</p>`:''}</div>`).join('')||'<p>Aucune décision.</p>'}</section></div>`;
      container.querySelector('#validation-refresh').onclick=()=>{if(!busy)enter(container);};
      container.querySelectorAll('[data-renewal]').forEach(form=>{form.onsubmit=async event=>{
        event.preventDefault();event.stopPropagation();if(busy)return;
        const request=renewals[Number(form.dataset.renewal)],reason=form.elements.reason.value.trim();
        if(!reason)return global.alert('Indiquez une observation.');
        busy=true;container.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{await rpc('confirm_bon_renewal',{request_key:request._dbKey,expected_valid_until:request.bonValidUntil??null,approve:event.submitter?.value==='approve',reason});await enter(container);}
        catch(error){container.querySelector('#validation-message').textContent=error.message;}
        finally{busy=false;container.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };});
      container.onsubmit=async event=>{
        const form=event.target.closest('[data-index]'); if(!form)return;event.preventDefault();if(busy)return;
        const approve=event.submitter?.value==='approve',values=new FormData(form),request=requests[Number(form.dataset.index)];
        if(!values.get('manager'))return global.alert('Choisissez le gestionnaire dédié : il recevra le bon, y compris en cas de refus pour correction.');
        if(!approve&&!String(values.get('reason')||'').trim())return global.alert('Indiquez le motif du refus.');
        busy=true;container.querySelectorAll('button').forEach(b=>b.disabled=true);
        try {await rpc('decide_stock_request',{request_key:request._dbKey,approve,manager_uid:values.get('manager'),reason:values.get('reason')||''});await enter(container);}
        catch(error){container.querySelector('#validation-message').textContent=error.message;}
        finally{busy=false;container.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };
      env.readNotifications?.('validation-bons');
    }catch(error){if(token===generation)container.textContent=error.message;}
  }
  async function issue(request) {
    if(busy)return; const signature=request.managerSignatureText||global.prompt('Signez la remise physique avec votre nom complet :',env.profile()?.name||'');
    if(!signature?.trim())return;
    if(!global.confirm('Confirmer la remise physique du matériel et le débit du stock ?'))return;
    busy=true;
    try {
      const explicit=global.StockSubstocks?.enabled();
      const selections=explicit?await global.StockSubstocks.chooseIssue(request):null;
      if(explicit&&!selections)return;
      await rpc(explicit?'issue_validated_request_substocks':'issue_validated_request',{request_key:request._dbKey,signature,service:request.serviceAbbreviation,...(explicit?{selections}:{})});await env.refresh();global.alert('Sortie physique enregistrée et tracée.');busy=false;env.navigate('demandes-coordonnatrice');}
    catch(error){global.alert(error.message);}finally{busy=false;}
  }
  async function removeRejected(requestKey) {
    if(busy)return;
    const request=(env.data().demandes||[]).find(r=>r._dbKey===requestKey);
    if(!request||request.status!=='REFUSEE VALIDATEUR'||env.profile()?.role!=='Gestionnaire')return;
    if(!global.confirm('Supprimer définitivement le bon refusé '+(request.ref||request.id)+' ? Une trace sera conservée dans l’audit.'))return;
    busy=true;
    try {
      await rpc('delete_rejected_stock_request',{request_key:request._dbKey,expected_decision:request.validatorDecision??null});
      await env.refresh();env.navigate('demandes-coordonnatrice');
      global.alert('Bon refusé supprimé.');
    }catch(error){global.alert(error.message);}finally{busy=false;}
  }
  function correct(requestKey) {
    const request=(env.data().demandes||[]).find(r=>r._dbKey===requestKey);
    if(!request||request.status!=='REFUSEE VALIDATEUR'||env.profile()?.role!=='Gestionnaire')return;
    const operators=new Set((request.items||[]).map(i=>op(i.op||request.op)));
    const stocks=(env.data().stock||[]).filter(s=>operators.has(op(s.op))&&env.profile()?.controlScopes?.[op(s.op)]===true);
    const modal=document.createElement('dialog');modal.className='p-6 rounded-2xl w-full max-w-3xl';
    const row=item=>`<div data-line class="flex gap-2 my-2"><select name="stock" required class="border p-2 flex-1 min-w-0"><option value="">Choisir le matériel</option>${stocks.map(s=>`<option value="${esc(s._dbKey)}" ${op(s.op)===op(item.op||request.op)&&s.label===item.label?'selected':''}>${esc(s.op)} — ${esc(s.label)}</option>`).join('')}</select><input name="qty" type="number" step="any" min="0.000001" required value="${esc(item.qty||1)}" class="border p-2 w-24"><button type="button" data-remove>Retirer</button></div>`;
    modal.innerHTML=`<form class="space-y-3"><h2 class="font-bold">Corriger le bon ${esc(request.ref||request.id)}</h2><p class="text-red-700">Motif du refus : ${esc(request.validatorDecision?.reason)}</p>${corrections(request)}
      <label class="block">Destinataire<input name="recipient" required maxlength="200" class="border p-2 w-full" value="${esc(request.demandeurName||request.tech)}"></label>
      <label class="block">Motif<textarea name="motif" required maxlength="1000" class="border p-2 w-full">${esc(request.motif||request.ref)}</textarea></label>
      <label class="block">Service<select name="service" required class="border p-2">${['B2B','DEP','MAIN'].map(s=>`<option ${request.serviceAbbreviation===s?'selected':''}>${s}</option>`).join('')}</select></label>
      <div data-items>${(request.items||[]).map(row).join('')}</div><button type="button" data-add>Ajouter un matériel</button>
      <label class="block">Correction effectuée<textarea name="note" required maxlength="2000" class="border p-2 w-full"></textarea></label>
      <p>Les anciennes signatures restent dans la version précédente. Le bon corrigé repasse en validation avant toute sortie.</p><p role="status" class="text-red-700"></p>
      <button type="submit" class="bg-indigo-700 text-white rounded p-3">Corriger et renvoyer au validateur</button><button type="button" data-close class="p-3">Annuler</button></form>`;
    document.body.append(modal);modal.showModal();
    modal.querySelector('[data-close]').onclick=()=>{if(!busy)modal.close();};modal.onclose=()=>modal.remove();modal.oncancel=e=>{if(busy)e.preventDefault();};
    modal.onclick=e=>{if(busy)return;if(e.target.closest('[data-remove]'))e.target.closest('[data-line]').remove();if(e.target.closest('[data-add]'))modal.querySelector('[data-items]').insertAdjacentHTML('beforeend',row({}));};
    modal.onsubmit=async event=>{
      event.preventDefault();if(busy)return;
      const values=new FormData(event.target),items=Array.from(modal.querySelectorAll('[data-line]'),line=>({stockKey:line.querySelector('[name=stock]').value,qty:Number(line.querySelector('[name=qty]').value)}));
      if(!items.length){modal.querySelector('[role=status]').textContent='Ajoutez au moins un matériel.';return;}
      busy=true;modal.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{
        await rpc('resubmit_stock_request',{request_key:request._dbKey,expected_decision:request.validatorDecision,correction:{items,motif:values.get('motif'),demandeurName:values.get('recipient'),serviceAbbreviation:values.get('service'),note:values.get('note')}});
        modal.close();await env.refresh();env.navigate('demandes-coordonnatrice');global.alert('Bon corrigé et renvoyé au validateur.');
      }catch(error){modal.querySelector('[role=status]').textContent=error.message;}
      finally{busy=false;modal.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };
  }
  global.ValidatorWorkflow={setup,menu,enter,enabled,isValidator,covers,trace,corrections,correct,removeRejected,issue,stop:()=>{generation++;},isBusy:()=>busy};
})(window);
