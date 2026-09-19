(function(global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roles = ['Validateur','Validatrice'];
  let env, busy = false, generation = 0;
  const enabled = () => env?.profile()?.validatorWorkflowEnabled === true;
  const isValidator = () => roles.includes(env?.profile()?.role);
  const rpc = async (name, args) => {const {data,error} = await env.client().rpc(name,args); if(error) throw error; return data;};
  const op = value => String(value || '').trim().toUpperCase() === 'ITC' ? 'ITC-B01' : String(value || '').trim().toUpperCase();
  const covers = request => Array.isArray(request?.items) && request.items.length > 0 && request.items.every(item => env?.profile()?.controlScopes?.[op(item.op || request.op)] === true);
  function setup(config) {env=config;}
  function menu() {
    let element = document.getElementById('menu-validator');
    if (!element) {
      element = document.createElement('div'); element.id='menu-validator';
      element.innerHTML='<button type="button" class="w-full text-left p-3 rounded-xl bg-indigo-800 text-white font-bold">Validation des bons</button>';
      element.firstChild.onclick=()=>env.navigate('validation-bons');
      document.getElementById('menu-cockpit')?.before(element);
    }
    element.classList.toggle('hidden',!isValidator());
  }
  function trace(request) {
    const decision=request.validatorDecision;
    return decision ? `${decision.approved?'Validé':'Refusé'} par ${decision.name || 'Validateur'} le ${new Date(decision.at).toLocaleString('fr-FR')}${decision.reason?' — '+decision.reason:''}${request.assignedGestionnaireName?' · Gestionnaire : '+request.assignedGestionnaireName:''}` : '';
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
      const history=(env.data().demandes||[]).filter(r=>r.validatorDecision && covers(r)).sort((a,b)=>b.validatorDecision.at.localeCompare(a.validatorDecision.at));
      container.innerHTML=`<div class="space-y-5 p-4"><header class="bg-indigo-800 text-white p-6 rounded-2xl"><h2 class="text-xl font-bold">Validation des bons</h2><p>${requests.length} bon(s) à traiter. Une validation transmet le bon au gestionnaire dédié ; le stock sera débité à la remise physique.</p><button type="button" id="validation-refresh" class="border rounded-lg p-2 mt-3">Actualiser les bons</button></header>
        <p class="font-bold">Bureau de validation : ${esc(env.profile()?.validationBureau || 'Non affecté')} · Stocks : ${esc(Object.keys(env.profile()?.controlScopes || {}).filter(key=>env.profile().controlScopes[key]===true).join(', ') || 'Aucun')}</p>
        ${enabled()?'':'<p>Le nouveau circuit est en cours de préparation.</p>'}
        <p role="status" id="validation-message"></p>
        ${requests.map((r,index)=>{
          const ops=[...new Set((r.items||[]).map(i=>op(i.op||r.op)))];
          const eligible=managers.filter(m=>ops.every(o=>m.scopes?.[o]===true));
          return `<form data-index="${index}" class="bg-white border rounded-2xl p-5 space-y-3"><h3 class="font-bold">${esc(r.ref||r.id)} — ${esc(r.demandeurName||r.tech||r.createdBy)}</h3><p>${esc(r.motif||'')} · ${esc(ops.join(', '))}</p>
            <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr><th class="text-left">Stock</th><th class="text-left">Matériel</th><th class="text-right">Quantité</th></tr></thead><tbody>${(r.items||[]).map(i=>`<tr><td>${esc(op(i.op||r.op))}</td><td>${esc(i.label)}</td><td class="text-right">${esc(i.qty)}</td></tr>`).join('')}</tbody></table></div>
            ${r.coordinationSignatureText?`<p>Coordination : ${esc(r.coordinationSignatureText)}</p>`:''}
            <label class="block">Gestionnaire dédié<select name="manager" class="border p-3 rounded-lg w-full"><option value="">Choisir le gestionnaire</option>${eligible.map(m=>`<option value="${esc(m.uid)}">${esc(m.name)}</option>`).join('')}</select></label>
            ${eligible.length?'':'<p class="text-amber-800">Aucun gestionnaire ne couvre tous les stocks de ce bon. Refusez-le en demandant des bons séparés par gestionnaire.</p>'}
            <label class="block">Observation / motif du refus<textarea name="reason" maxlength="1000" class="border p-3 rounded-lg w-full"></textarea></label>
            <button type="submit" name="decision" value="approve" class="bg-green-700 text-white p-3 rounded-lg">Valider et transmettre</button>
            <button type="submit" name="decision" value="reject" class="bg-red-700 text-white p-3 rounded-lg">Refuser</button></form>`;
        }).join('') || '<p>Aucun bon en attente de validation.</p>'}
        <section class="bg-white border p-5 rounded-2xl"><h3 class="font-bold">Décisions et suivi</h3>${history.map(r=>`<div class="border-b py-3"><b>${esc(r.ref||r.id)}</b> — ${esc(r.status)}<p>${esc(trace(r))}</p>${r.validatedAt?`<p>Sortie physique : ${esc(r.validatedBy)} · ${esc(new Date(r.validatedAt).toLocaleString('fr-FR'))}</p>`:''}</div>`).join('')||'<p>Aucune décision.</p>'}</section></div>`;
      container.querySelector('#validation-refresh').onclick=()=>{if(!busy)enter(container);};
      container.onsubmit=async event=>{
        const form=event.target.closest('[data-index]'); if(!form)return;event.preventDefault();if(busy)return;
        const approve=event.submitter?.value==='approve',values=new FormData(form),request=requests[Number(form.dataset.index)];
        if(approve&&!values.get('manager'))return global.alert('Choisissez le gestionnaire dédié.');
        if(!approve&&!String(values.get('reason')||'').trim())return global.alert('Indiquez le motif du refus.');
        busy=true;container.querySelectorAll('button').forEach(b=>b.disabled=true);
        try {await rpc('decide_stock_request',{request_key:request._dbKey,approve,manager_uid:approve?values.get('manager'):null,reason:values.get('reason')||''});await enter(container);}
        catch(error){container.querySelector('#validation-message').textContent=error.message;}
        finally{busy=false;container.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };
    }catch(error){if(token===generation)container.textContent=error.message;}
  }
  async function issue(request) {
    if(busy)return; const signature=request.managerSignatureText||global.prompt('Signez la remise physique avec votre nom complet :',env.profile()?.name||'');
    if(!signature?.trim())return;
    if(!global.confirm('Confirmer la remise physique du matériel et le débit du stock ?'))return;
    busy=true;
    try {await rpc('issue_validated_request',{request_key:request._dbKey,signature,service:request.serviceAbbreviation});await env.refresh();global.alert('Sortie physique enregistrée et tracée.');busy=false;env.navigate('demandes-coordonnatrice');}
    catch(error){global.alert(error.message);}finally{busy=false;}
  }
  global.ValidatorWorkflow={setup,menu,enter,enabled,isValidator,covers,trace,issue,stop:()=>{generation++;},isBusy:()=>busy};
})(window);
