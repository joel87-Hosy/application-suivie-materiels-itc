(function(global){
  'use strict';
  const states=new WeakMap();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function mount(container){
    const holder=container.querySelector('[data-request-routing]');if(!holder)return;
    const state={loading:true};states.set(holder,state);holder.textContent='Chargement du circuit de validation…';
    try{
      const {data,error}=await global.ITCSupabaseConfig.client.rpc('workflow_request_choices',{});if(error)throw error;
      if(!holder.isConnected||states.get(holder)!==state)return;
      Object.assign(state,data,{loading:false});
      if(!data.enabled){holder.innerHTML='';return;}
      holder.innerHTML=`<fieldset class="border rounded-xl p-4 space-y-3"><legend class="font-bold">Choisir le circuit de ce bon</legend><label class="block">Bureau du validateur<select data-routing-office required class="w-full border p-3"><option value="">Choisir le bureau</option><option value="B01">Bureau 01</option><option value="B02">Bureau 02</option></select></label><label class="block">Validateur / Validatrice<select data-routing-validator required class="w-full border p-3"><option value="">Choisir d'abord le bureau</option></select></label><label class="block">Gestionnaire auprès duquel retirer le matériel<select data-routing-manager required class="w-full border p-3"><option value="">Choisir le gestionnaire</option>${data.managers.map(m=>`<option value="${esc(m.uid)}">${esc(m.name)} — ${esc(Object.keys(m.scopes||{}).filter(op=>m.scopes[op]===true).join(', '))}</option>`).join('')}</select></label><p class="text-sm">Seul le validateur choisi recevra ce bon. Le gestionnaire doit gérer tous les stocks demandés.</p></fieldset>`;
      holder.querySelector('[data-routing-office]').onchange=e=>{holder.querySelector('[data-routing-validator]').innerHTML='<option value="">Choisir le validateur</option>'+data.validators.filter(v=>v.offices.includes(e.target.value)).map(v=>`<option value="${esc(v.uid)}">${esc(v.name)}</option>`).join('');};
      const old=container.querySelector('#coord-assign-gestionnaire');
      if(old){old.closest('div').hidden=true;old.required=false;holder.querySelector('[data-routing-manager]').onchange=e=>{const selected=data.managers.find(m=>m.uid===e.target.value);old.value=selected?.id??'';};}
    }catch(error){state.loading=false;state.error=error.code==='PGRST202'?'Mettez à jour le serveur pour activer le choix du circuit.':error.message;holder.textContent=state.error;}
  }
  function values(container,items){
    const holder=container.querySelector('[data-request-routing]');if(!holder)return {};
    const state=states.get(holder);if(!state||state.loading)throw Error('Patientez pendant le chargement du circuit de validation.');if(state.error)throw Error(state.error);if(!state.enabled)return {};
    const requestedValidationOffice=holder.querySelector('[data-routing-office]').value,requestedValidatorUid=holder.querySelector('[data-routing-validator]').value,requestedManagerUid=holder.querySelector('[data-routing-manager]').value;
    if(!state.validators.some(v=>v.uid===requestedValidatorUid&&v.offices.includes(requestedValidationOffice)))throw Error('Choisissez le bureau et son validateur.');
    const manager=state.managers.find(m=>m.uid===requestedManagerUid);if(!manager)throw Error('Choisissez le gestionnaire destinataire.');
    if(!items.length||items.some(item=>{let op=String(item.op||'').trim().toUpperCase();if(op==='ITC')op='ITC-B01';return manager.scopes?.[op]!==true;}))throw Error('Le gestionnaire choisi ne gère pas tous les stocks demandés. Choisissez un autre gestionnaire ou séparez les demandes.');
    return {requestedValidationOffice,requestedValidatorUid,requestedManagerUid};
  }
  global.RequestRouting={mount,values};
})(window);
