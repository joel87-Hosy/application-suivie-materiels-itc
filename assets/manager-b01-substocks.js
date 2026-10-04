(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors=['#7c3aed','#0891b2','#059669','#d97706','#db2777','#2563eb'];
  let env,busy=false;
  const owned=op=>env?.profile()?.role==='Gestionnaire'&&['ITC-B01','OCI','CIC','MTN'].includes(global.ControlCore.operator(op))&&global.StockSubstocks?.owns(op);
  const items=op=>(env.data().stock||[]).filter(row=>row.company_id===env.profile().company_id&&global.ControlCore.operator(row.op)===global.ControlCore.operator(op));
  async function rpc(name,args){const {data,error}=await env.client().rpc(name,args);if(error)throw new Error(error.code==='PGRST202'?'Appliquez la migration 202610080001_manager_substocks_b01.sql dans Supabase.':error.message);return data;}
  async function open(op){
    if(!owned(op))return;
    const dialog=document.createElement('dialog');dialog.className='substock-dialog';dialog.innerHTML='<p>Chargement des sous-stocks…</p>';document.body.append(dialog);dialog.showModal();
    dialog.onclose=()=>{dialog.remove();env.onClose?.();};dialog.oncancel=e=>{if(busy)e.preventDefault();};
    let categories=[],filter='all';
    const refreshCategories=async()=>{categories=await rpc('list_manager_substock_categories',{stock_op:op});};
    const draw=()=>{
      if(!dialog.isConnected)return;
      const stock=items(op),unallocated=row=>Math.max(0,Number(row.qty||0)-categories.reduce((sum,c)=>sum+(Number(row.subStocks?.[c.id])||0),0));
      const buckets=[...categories.map((c,i)=>({...c,color:colors[i%colors.length]})),{id:'unallocated',name:'À répartir',color:'#64748b'}];
      const rows=stock.filter(row=>filter==='all'||(filter==='unallocated'?unallocated(row)>0:(Number(row.subStocks?.[filter])||0)>0));
      dialog.innerHTML=`<header><div><p>GESTIONNAIRE BUREAU 01</p><h2>${esc(global.ControlCore.operator(op))} · Sous-stocks</h2></div><button type="button" data-close>Fermer</button></header><p>Créez les sous-stocks propres à ce stock principal, puis répartissez les quantités des articles. Le stock total reste inchangé.</p><form data-create class="substock-toolbar"><label class="flex-1">Nom du sous-stock<input name="name" required maxlength="80" class="w-full border rounded-xl p-3 mt-1" placeholder="Nom du service, agence ou équipe"></label><button type="submit">Créer le sous-stock</button></form><div class="substock-cards">${buckets.map(b=>`<button type="button" data-filter="${b.id}" style="--substock-color:${b.color}" aria-pressed="${filter===b.id}"><span>${esc(b.name)}</span><strong>${b.id==='unallocated'?stock.reduce((n,row)=>n+unallocated(row),0):stock.reduce((n,row)=>n+(Number(row.subStocks?.[b.id])||0),0)}</strong><small>Voir les articles</small></button>`).join('')}</div><div class="substock-toolbar"><button type="button" data-filter="all">Tous les articles (${stock.length})</button><span>Stock total : ${stock.reduce((sum,row)=>sum+Number(row.qty||0),0)}</span></div><p data-status role="status"></p><div class="substock-items">${rows.map((row,index)=>`<details><summary><b>${esc(row.label)}</b><span>${Number(row.qty)||0} au total · ${unallocated(row)} à répartir</span></summary><form data-index="${index}"><p>Indiquez la quantité à placer dans chaque sous-stock.</p><div class="substock-fields">${categories.map(c=>`<label>${esc(c.name)}<input type="number" name="${c.id}" min="0" step="any" required max="${Number(row.qty)||0}" value="${Number(row.subStocks?.[c.id])||0}"></label>`).join('')||'<p>Créez vos sous-stocks pour répartir les quantités.</p>'}</div>${categories.length?'<button type="submit">Enregistrer la répartition</button>':''}</form></details>`).join('')||'<p>Aucun article dans ce stock.</p>'}</div>`;
      dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};
      dialog.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{if(!busy){filter=button.dataset.filter;draw();}});
      dialog.onsubmit=async event=>{
        event.preventDefault();if(busy)return;const form=event.target;busy=true;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);
        try{
          if(form.matches('[data-create]')){
            const category=await rpc('create_manager_substock_category',{stock_op:op,substock_name:form.elements.name.value.trim()});
            await refreshCategories();filter='all';draw();dialog.querySelector('[data-status]').textContent='Sous-stock créé.';
          }else{
            const row=rows[Number(form.dataset.index)],values=new FormData(form),buckets=Object.fromEntries(categories.map(c=>[c.id,Number(values.get(c.id))]));
            if(Object.values(buckets).some(n=>!Number.isFinite(n)||n<0)||Object.values(buckets).reduce((sum,n)=>sum+n,0)>Number(row.qty)){dialog.querySelector('[data-status]').textContent='La somme doit être inférieure ou égale au stock total.';return;}
            await rpc('reorganize_stock_substocks',{stock_key:row._dbKey,expected:row,buckets});await env.refresh();draw();dialog.querySelector('[data-status]').textContent='Répartition enregistrée.';
          }
        }catch(error){dialog.querySelector('[data-status]').textContent=error.message;}
        finally{busy=false;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
      };
    };
    try{await env.refresh();await refreshCategories();draw();}catch(error){dialog.textContent=error.message;const close=document.createElement('button');close.textContent='Fermer';close.onclick=()=>dialog.close();dialog.append(close);}
  }
  global.ManagerB01Substocks={setup:config=>{env=config;},open};
  const baseOpen=global.StockSubstocks?.open;
  if(baseOpen)global.StockSubstocks.open=operator=>owned(operator)?open(operator):baseOpen(operator);
})(window);
