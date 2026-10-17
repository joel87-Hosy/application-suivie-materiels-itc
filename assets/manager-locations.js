(function(global){
  'use strict';
  let env, busy=false, generation=0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function rpc(name,args){
    const {data,error}=await env.client().rpc(name,args);
    if(error)throw new Error(error.code==='PGRST202'?'La création de stocks n’est pas encore activée sur le serveur. Contactez l’administrateur.':error.message);
    return data;
  }
  async function enter(container,selected=''){
    const token=++generation;
    if(env.profile()?.role!=='Gestionnaire'){container.textContent='Accès réservé aux gestionnaires.';return;}
    const company=env.profile().company_id;
    let cached=(env.data().stock_locations||[]).filter(l=>l.company_id===company);
    if(!container.dataset.managerLocationsReady)container.innerHTML='<p class="p-6" role="status">Ouverture de vos stocks…</p>';
    try{
      if(cached.length)render(container,cached,selected,token);
      const locations=await (async()=>{const list=[];for(;;){const {data,error}=await env.client().from('stock_locations').select('*').eq('company_id',company).order('op').range(list.length,list.length+499);if(error)throw error;if(token!==generation)return [];if(!data?.length)break;list.push(...data);}return list;})();
      if(token!==generation)return;
      env.data().stock_locations=locations;
      if(locations.length||!cached.length)render(container,locations,selected,token);
      env.refresh().then(()=>{if(token===generation)render(container,locations,selected,token);}).catch(error=>console.warn('Actualisation des stocks assignés indisponible',error));
    }catch(error){if(token===generation&&!container.dataset.managerLocationsReady)container.textContent=error.message;}
  }
  function render(container,locations,selected,token){
      const company=env.profile().company_id;
      const assigned=new Set(global.ControlCore.managerStocks(env.profile()));
      const owned=locations.filter(l=>assigned.has(l.op));
      const names=new Map(locations.map(l=>[l.op,l.name]));
      const title=l=>l.parent_op?`${names.get(l.parent_op)||l.parent_op} › ${l.name}`:l.name;
      owned.sort((a,b)=>title(a).localeCompare(title(b),'fr'));
      const custom=owned.filter(l=>l.created_by);
      const active=owned.find(l=>l.op===selected)||custom[0]||owned[0];
      const items=(env.data().stock||[]).filter(i=>i.company_id===company&&i.op===active?.op);
      const children=owned.filter(location=>location.parent_op===active?.op);
      const options=(rows,empty=false)=>`${empty?'<option value="">Aucun — créer un stock principal</option>':''}${rows.map(l=>`<option value="${esc(l.op)}" ${l.op===active?.op?'selected':''}>${esc(title(l))}</option>`).join('')}`;
      container.innerHTML=`<div class="p-4 space-y-6"><h2 class="text-xl font-bold">Mes stocks et sous-stocks</h2><p>Créez vos espaces de stockage puis ajoutez leurs articles. Chaque nouvel espace vous est automatiquement attribué.</p>
        <form data-create class="bg-white p-5 rounded-2xl space-y-3"><h3 class="font-bold">Créer un stock ou un sous-stock</h3>
          <label class="block">Nom<input name="locationName" required maxlength="100" class="border rounded-xl p-3 w-full"></label>
          <label class="block">Stock parent<select name="parent" class="border rounded-xl p-3 w-full">${options(owned,true)}</select></label>
          <p class="text-sm">Choisissez un parent pour créer un sous-stock. Chaque espace possède ses propres quantités ; celles des sous-stocks ne sont pas ajoutées au stock parent.</p>
          <button class="bg-indigo-700 text-white rounded-xl p-3" type="submit">Créer et m’attribuer ce stock</button><p role="status"></p></form>
        ${active&&!active.parent_op?`<section class="bg-white p-5 rounded-2xl space-y-3"><div class="flex items-center justify-between gap-3"><div><h3 class="font-bold">Sous-stocks de ${esc(active.name)}</h3><p class="text-sm text-slate-500">${children.length} sous-stock(s)</p></div><button type="button" data-create-child class="bg-indigo-700 text-white rounded-xl p-3">${children.length?'Ajouter un sous-stock':'Créer un sous-stock'}</button></div><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">${children.map(child=>{const childItems=(env.data().stock||[]).filter(item=>item.company_id===company&&item.op===child.op),total=childItems.reduce((sum,item)=>sum+(Number(item.qty)||0),0);return `<button type="button" data-open-child="${esc(child.op)}" class="border border-indigo-200 border-t-4 border-t-indigo-500 rounded-2xl p-4 text-left hover:shadow-lg"><strong class="block">${esc(child.name)}</strong><span class="block text-2xl font-black text-indigo-900 mt-2">${total} U</span><small class="text-slate-500">${childItems.length} article(s) · Voir le contenu</small></button>`;}).join('')||'<p class="text-slate-500">Aucun sous-stock créé pour ce stock.</p>'}</div></section>`:''}
        <section class="bg-white p-5 rounded-2xl space-y-3"><h3 class="font-bold">Vos espaces de stockage (${owned.length})</h3>
          <label class="block">Stock à consulter<select data-location class="border rounded-xl p-3 w-full">${options(owned)}</select></label>
          ${active?`<h4 class="font-bold">${esc(title(active))}</h4><p>${items.length} article(s)</p>`:'<p>Créez votre premier stock.</p>'}
          <div class="overflow-x-auto"><table class="w-full text-left"><thead><tr><th>Article</th><th>Type</th><th>Quantité</th><th>Actions</th></tr></thead><tbody>${items.map((item,i)=>`<tr class="border-b"><td class="p-2">${esc(item.label)}</td><td>${esc(item.type)}</td><td>${esc(item.qty)}</td><td><button type="button" data-edit="${i}" class="p-2 text-indigo-700">Modifier</button><button type="button" data-remove="${i}" class="p-2 text-red-700">Supprimer</button></td></tr>`).join('')||'<tr><td colspan="4" class="p-4">Aucun article dans cet espace.</td></tr>'}</tbody></table></div>
        </section>
        ${active?.created_by?`<form data-receive class="bg-white p-5 rounded-2xl space-y-3"><h3 class="font-bold">Ajouter des articles à ${esc(title(active))}</h3>
          <label class="block">Désignation<input name="label" required maxlength="200" class="border rounded-xl p-3 w-full"></label>
          <label class="block">Type de matériel<input name="materialType" required maxlength="100" list="location-material-types" class="border rounded-xl p-3 w-full"></label>
          <datalist id="location-material-types">${(env.data().materialTypes||[]).map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist>
          <label class="block">Quantité à ajouter<input name="quantity" type="number" min="0.001" step="any" max="9007199254740991" required class="border rounded-xl p-3 w-full"></label>
          <p class="text-sm">Pour un article existant de même type, la quantité sera ajoutée à celle en stock.</p>
          <button type="submit" class="bg-emerald-700 text-white rounded-xl p-3">Enregistrer l’entrée</button><p role="status"></p></form>`:active?'<button type="button" data-reception class="bg-emerald-700 text-white rounded-xl p-3">Ajouter des articles via Réception matériel</button>':''}
        <button type="button" data-refresh class="border rounded-xl p-3">Actualiser mes stocks</button></div>`;
      container.dataset.managerLocationsReady='true';
      container.querySelector('[data-create]').elements.parent.value=active&&!active.parent_op?active.op:'';
      container.querySelector('[data-location]').onchange=e=>enter(container,e.target.value);
      container.querySelector('[data-create-child]')?.addEventListener('click',()=>{const form=container.querySelector('[data-create]');form.elements.parent.value=active.op;form.elements.locationName.focus();form.scrollIntoView({behavior:'smooth',block:'center'});});
      container.querySelectorAll('[data-open-child]').forEach(button=>button.onclick=()=>enter(container,button.dataset.openChild));
      container.querySelector('[data-refresh]').onclick=()=>{container.dataset.managerLocationsReady='';enter(container,active?.op);};
      container.querySelector('[data-reception]')?.addEventListener('click',()=>env.navigate('reception'));
      container.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>global.ManagerStock.edit(items[Number(b.dataset.edit)]));
      container.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>global.ManagerStock.remove(items[Number(b.dataset.remove)]));
      const bind=(form,name,argsFor,resultSelection)=>{
        if(!form)return;
        let attempt=null,operationId;
        form.onsubmit=async e=>{
          e.preventDefault();if(busy||token!==generation)return;
          const args=argsFor(form.elements),fingerprint=JSON.stringify(args);
          if(fingerprint!==attempt){attempt=fingerprint;operationId=global.crypto.randomUUID();}
          busy=true;
          container.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
          const status=form.querySelector('[role=status]');status.textContent='Enregistrement…';
          try{
            const result=await rpc(name,{operation_id:operationId,...args});
            await env.reloadProfile();
            if(token===generation)await enter(container,resultSelection(result));
            if(env.onLocationsChanged)await env.onLocationsChanged();
          }catch(error){if(token===generation)status.textContent=error.message;}
          finally{busy=false;container.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
        };
      };
      bind(container.querySelector('[data-create]'),'create_manager_stock_location',f=>({location_name:f.locationName.value.trim(),parent_stock:f.parent.value||null}),r=>r.op);
      bind(container.querySelector('[data-receive]'),'receive_manager_location_item',f=>({stock_op:active.op,material_label:f.label.value.trim(),material_type:f.materialType.value.trim(),quantity:Number(f.quantity.value)}),()=>active.op);
  }
  global.ManagerLocations={setup:config=>{env=config;},enter,isBusy:()=>busy,stop:()=>{generation++;}};
})(window);
