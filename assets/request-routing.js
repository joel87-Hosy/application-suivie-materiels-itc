(function(global){
  'use strict';
  const states=new WeakMap();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const officeOps={B01:['ITC-B01','OCI','CIC','MTN'],B02:['ITC-B02','MOOV']};
  const itemOp=item=>{let op=String(item.op||'').trim().toUpperCase();return op==='ITC'?'ITC-B01':op;};
  function filteredManagers(state,office,items){const required=new Set((items||[]).map(itemOp));return (state.managers||[]).filter(m=>{const scopes=m.scopes||{};return [...required].every(op=>scopes[op]===true)&&[...(officeOps[office]||[])].some(op=>scopes[op]===true);});}
  async function mount(container){
    const holder=container.querySelector('[data-request-routing]');if(!holder)return;
    const state={loading:true};states.set(holder,state);holder.textContent='Chargement du circuit de validation…';
    try{
      const {data,error}=await global.ITCSupabaseConfig.client.rpc('workflow_request_choices',{});if(error)throw error;
      if(!holder.isConnected||states.get(holder)!==state)return;
      Object.assign(state,data,{loading:false});if(!data.enabled){holder.innerHTML='';return;}
      const offices=(data.offices||[]).filter(o=>['B01','B02'].includes(o));
      holder.innerHTML=`<fieldset class="border rounded-xl p-4 space-y-3"><legend class="font-bold">Choisir le circuit de ce bon</legend><label class="block">Bureau du validateur<select data-routing-office required class="w-full border p-3"><option value="">Choisir le bureau</option>${offices.map(o=>`<option value="${esc(o)}">Bureau ${o.slice(1)}</option>`).join('')}</select></label><label class="block">Validateur / Validatrice<select data-routing-validator required class="w-full border p-3"><option value="">Choisir d'abord le bureau</option></select></label><label class="block">Gestionnaire auprès duquel retirer le matériel<select data-routing-manager required class="w-full border p-3"><option value="">Choisir le gestionnaire</option></select></label><p class="text-sm">Seul le validateur choisi recevra ce bon. Le gestionnaire doit gérer tous les stocks demandés.</p></fieldset>`;
      const officeSelect=holder.querySelector('[data-routing-office]'),validator=holder.querySelector('[data-routing-validator]'),manager=holder.querySelector('[data-routing-manager]');
      const refresh=()=>{const office=container.querySelector('#s-office')?.value||officeSelect.value;officeSelect.value=office;validator.innerHTML='<option value="">Choisir le validateur</option>'+(data.validators||[]).filter(v=>(v.offices||[]).includes(office)).map(v=>`<option value="${esc(v.uid)}">${esc(v.name)}</option>`).join('');const items=container.querySelectorAll('.sortie-op-check:checked');const selected=Array.from(items,x=>({op:x.value}));const allowed=filteredManagers(state,office,selected);manager.innerHTML='<option value="">Choisir le gestionnaire</option>'+allowed.map(m=>`<option value="${esc(m.uid)}">${esc(m.name)} — ${esc(Object.keys(m.scopes||{}).filter(op=>m.scopes[op]===true).join(', '))}</option>`).join('');};
      officeSelect.onchange=refresh;container.querySelector('#s-office')?.addEventListener('change',refresh);container.addEventListener('change',e=>{if(e.target.matches('.sortie-op-check'))refresh();});refresh();
      const old=container.querySelector('#coord-assign-gestionnaire');if(old){old.closest('div').hidden=true;old.required=false;manager.onchange=e=>{const selected=data.managers.find(m=>m.uid===e.target.value);old.value=selected?.id??'';};}
    }catch(error){state.loading=false;state.error=error.code==='PGRST202'?'Mettez à jour le serveur pour activer le choix du circuit.':error.message;holder.textContent=state.error;}
  }
  function values(container,items){
    const holder=container.querySelector('[data-request-routing]');if(!holder)return {};
    const state=states.get(holder);if(!state||state.loading)throw Error('Patientez pendant le chargement du circuit de validation.');if(state.error)throw Error(state.error);if(!state.enabled)return {};
    const requestOffice=container.querySelector('#s-office')?.value,requestedValidationOffice=holder.querySelector('[data-routing-office]').value,requestedValidatorUid=holder.querySelector('[data-routing-validator]').value,requestedManagerUid=holder.querySelector('[data-routing-manager]').value;
    if(!requestOffice||requestedValidationOffice!==requestOffice)throw Error('Le bureau du validateur doit correspondre au bureau émetteur choisi.');
    if(!state.validators.some(v=>v.uid===requestedValidatorUid&&(v.offices||[]).includes(requestedValidationOffice)))throw Error('Choisissez le bureau et son validateur.');
    const manager=filteredManagers(state,requestOffice,items).find(m=>m.uid===requestedManagerUid);if(!manager)throw Error('Choisissez un gestionnaire compatible avec le bureau et tous les stocks demandés.');
    if(!items.length||items.some(item=>!(officeOps[requestOffice]||[]).includes(itemOp(item))))throw Error('Chaque stock demandé doit appartenir au bureau émetteur choisi.');
    return {requestedValidationOffice,requestedValidatorUid,requestedManagerUid};
  }
  global.RequestRouting={mount,values};
})(window);
