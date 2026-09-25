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
    container.innerHTML='<p class="p-6" role="status">Chargement de vos stocks…</p>';
    try{
      await env.refresh();
      const locations=[];
      for(;;){
        const {data,error}=await env.client().from('stock_locations').select('*').eq('company_id',company).order('op').range(locations.length,locations.length+499);
        if(error)throw error;
        if(token!==generation)return;
        if(!data?.length)break;
        locations.push(...data);
      }
      const assigned=new Set(global.ControlCore.managerStocks(env.profile()));
      const owned=locations.filter(l=>assigned.has(l.op));
      const names=new Map(locations.map(l=>[l.op,l.name]));
      const title=l=>l.parent_op?`${names.get(l.parent_op)||l.parent_op} › ${l.name}`:l.name;
      owned.sort((a,b)=>title(a).localeCompare(title(b),'fr'));
      const custom=owned.filter(l=>l.created_by);
      const active=owned.find(l=>l.op===selected)||custom[0]||owned[0];
      const items=(env.data().stock||[]).filter(i=>i.company_id===company&&i.op===active?.op);
      const options=(rows,empty=false)=>`${empty?'<option value="">Aucun — créer un stock principal</option>':''}${rows.map(l=>`<option value="${esc(l.op)}" ${l.op===active?.op?'selected':''}>${esc(title(l))}</option>`).join('')}`;
      container.innerHTML=`<div class="p-4 space-y-6"><h2 class="text-xl font-bold">Mes stocks et sous-stocks</h2><p>Créez vos espaces de stockage puis ajoutez leurs articles. Chaque nouvel espace vous est automatiquement attribué.</p>
        <form data-create class="bg-white p-5 rounded-2xl space-y-3"><h3 class="font-bold">Créer un stock ou un sous-stock</h3>
          <label class="block">Nom<input name="locationName" required maxlength="100" class="border rounded-xl p-3 w-full"></label>
          <label class="block">Stock parent<select name="parent" class="border rounded-xl p-3 w-full">${options(owned,true)}</select></label>
          <p class="text-sm">Choisissez un parent pour créer un sous-stock. Chaque espace possède ses propres quantités ; celles des sous-stocks ne sont pas ajoutées au stock parent.</p>
          <button class="bg-indigo-700 text-white rounded-xl p-3" type="submit">Créer et m’attribuer ce stock</button><p role="status"></p></form>
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
      container.querySelector('[data-create]').elements.parent.value='';
      container.querySelector('[data-location]').onchange=e=>enter(container,e.target.value);
      container.querySelector('[data-refresh]').onclick=()=>enter(container,active?.op);
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
          }catch(error){if(token===generation)status.textContent=error.message;}
          finally{busy=false;container.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
        };
      };
      bind(container.querySelector('[data-create]'),'create_manager_stock_location',f=>({location_name:f.locationName.value.trim(),parent_stock:f.parent.value||null}),r=>r.op);
      bind(container.querySelector('[data-receive]'),'receive_manager_location_item',f=>({stock_op:active.op,material_label:f.label.value.trim(),material_type:f.materialType.value.trim(),quantity:Number(f.quantity.value)}),()=>active.op);
    }catch(error){if(token===generation)container.textContent=error.message;}
  }
  global.ManagerLocations={setup:config=>{env=config;},enter,isBusy:()=>busy,stop:()=>{generation++;}};
})(window);
