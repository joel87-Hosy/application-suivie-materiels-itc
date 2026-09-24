(function(global){
  'use strict';
  const names={production:'Stock-production',deploiement:'Stock-déploiement',maintenance:'Stock-maintenance',unallocated:'À répartir'};
  const colors={production:'#059669',deploiement:'#2563eb',maintenance:'#d97706',unallocated:'#64748b'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let env,busy=false,pendingReceipt=null;
  const enabled=()=>env?.profile()?.role==='Gestionnaire'&&env.profile().controlScopes?.['ITC-B02']===true;
  const owns=operator=>enabled()&&global.ControlCore.managerStocks(env.profile()).includes(global.ControlCore.operator(operator));
  function quantities(item){const b=item.subStocks||{};return {...Object.fromEntries(Object.keys(names).filter(k=>k!=='unallocated').map(k=>[k,Number(b[k])||0])),unallocated:Math.max(0,Number(item.qty||0)-Object.values(b).reduce((s,v)=>s+Number(v||0),0))};}
  const entries=operator=>(env.data().stock||[]).filter(s=>s.company_id===env.profile().company_id&&global.ControlCore.operator(s.op)===global.ControlCore.operator(operator));
  async function rpc(name,args){const {data,error}=await env.client().rpc(name,args);if(error)throw new Error(error.code==='PGRST202'?'Appliquez la migration 202609240004_bureau02_substocks.sql dans Supabase pour activer les sous-stocks.':error.message);return data;}
  function receptionField(){return enabled()?`<label class="block text-xs font-bold">Sous-stock destinataire<select id="r-substock" required class="w-full border-2 rounded-xl p-3 mt-2"><option value="">Choisir le sous-stock</option>${Object.entries(names).filter(([key])=>key!=='unallocated').map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label>`:'';}
  async function receive(mat,substock){
    if(!owns(mat.op))throw new Error('Stock hors de votre affectation.');
    if(!['production','deploiement','maintenance'].includes(substock))throw new Error('Choisissez un sous-stock destinataire.');
    const args={operator:mat.op,material_label:mat.label,material_type:mat.type,quantity:mat.qty,substock};
    const fingerprint=JSON.stringify([env.profile().uid,env.profile().company_id,args]);
    if(pendingReceipt?.fingerprint!==fingerprint)pendingReceipt={fingerprint,id:global.crypto.randomUUID()};
    await rpc('receive_stock_substock',{operation_id:pendingReceipt.id,...args});
    await env.refresh();pendingReceipt=null;
  }
  function pickerRows(operators){
    return operators.filter(owns).flatMap(operator=>entries(operator).flatMap(s=>Object.entries(quantities(s)).filter(([,qty])=>qty>0).map(([substock,qty])=>({op:operator,label:s.label,substock,qty}))));
  }
  function pickerHtml(operators,previous=[]){
    const rows=pickerRows(operators);
    return operators.filter(owns).map(operator=>`<section class="border rounded-xl p-3 bg-slate-50"><h4 class="font-bold text-blue-900 mb-3">${esc(operator)}</h4>${Object.entries(names).map(([bucket,name])=>{
      const items=rows.filter(r=>r.op===operator&&r.substock===bucket);
      return `<div class="mb-4"><h5 class="font-bold mb-2" style="color:${colors[bucket]}">${name}</h5>${items.map(r=>{
        const before=previous.find(p=>p.op===r.op&&p.label===r.label&&p.substock===bucket);
        return `<div class="sortie-stock-row flex gap-3 items-center bg-white border rounded-xl p-3 my-2" data-op="${esc(r.op)}" data-label="${esc(r.label)}" data-substock="${bucket}"><input aria-label="Choisir ${esc(r.label)} dans ${name}" type="checkbox" class="sortie-stock-check" ${before?'checked':''} onchange="const q=this.closest('.sortie-stock-row').querySelector('.sortie-stock-qty');if(this.checked&&!q.value)q.value=1;saveSortieDraft();"><div class="flex-1 min-w-0"><b>${esc(r.label)}</b><p class="text-xs text-slate-600">${name} · Disponible : ${r.qty}</p></div><input aria-label="Quantité ${esc(r.label)} dans ${name}" class="sortie-stock-qty border rounded-lg p-2 w-24" type="number" min="1" step="1" max="${r.qty}" value="${before?Number(before.qty):''}" placeholder="QTÉ" oninput="this.closest('.sortie-stock-row').querySelector('.sortie-stock-check').checked=Number(this.value)>0;saveSortieDraft();"></div>`;
      }).join('')||'<p class="text-xs text-slate-500">Aucun matériel disponible.</p>'}</div>`;
    }).join('')}</section>`).join('')||'<p>Cochez un stock dédié pour afficher ses sous-stocks.</p>';
  }
  async function chooseIssue(request){
    await env.refresh();
    const grouped=new Map();
    for(const item of request.items||[]){const op=global.ControlCore.operator(item.op||request.op),key=JSON.stringify([op,String(item.label).trim().toUpperCase()]);if(!grouped.has(key))grouped.set(key,{op,label:item.label,qty:0,defaults:{}});const row=grouped.get(key);row.qty+=Number(item.qty);if(item.substock)row.defaults[item.substock]=(row.defaults[item.substock]||0)+Number(item.qty);}
    const rows=[...grouped.values()];
    return new Promise(resolve=>{
      const modal=document.createElement('dialog');modal.className='substock-dialog';let result=null;
      modal.innerHTML=`<form><h2>Choisir les sous-stocks à débiter</h2><p>Répartissez la quantité de chaque matériel entre les sous-stocks disponibles.</p>${rows.map((r,i)=>{const stock=entries(r.op).find(s=>String(s.label).trim().toUpperCase()===String(r.label).trim().toUpperCase()),q=quantities(stock||{qty:0});return `<fieldset class="border rounded-xl p-4 my-3"><legend>${esc(r.op)} · ${esc(r.label)} — ${r.qty} à sortir</legend><div class="substock-fields">${Object.entries(names).map(([key,name])=>`<label>${name} (${q[key]} disponibles)<input data-index="${i}" data-bucket="${key}" type="number" min="0" step="any" max="${q[key]}" value="${r.defaults[key]||0}" required></label>`).join('')}</div></fieldset>`;}).join('')}<p role="status"></p><button type="submit">Confirmer les sous-stocks</button><button type="button" data-cancel>Annuler</button></form>`;
      document.body.append(modal);modal.showModal();modal.onclose=()=>{modal.remove();resolve(result);};modal.querySelector('[data-cancel]').onclick=()=>modal.close();
      modal.onsubmit=e=>{e.preventDefault();const selected=[];for(const [i,r] of rows.entries()){let total=0;for(const input of modal.querySelectorAll(`[data-index="${i}"]`)){const qty=Number(input.value);total+=qty;if(qty>0)selected.push({op:r.op,label:r.label,qty,substock:input.dataset.bucket});}if(Math.abs(total-r.qty)>0.0000001){modal.querySelector('[role=status]').textContent=`La quantité répartie pour ${r.label} doit être ${r.qty}.`;return;}}result=selected;modal.close();};
    });
  }
  function exportSubstock(operator,bucket,format){
    if(!owns(operator)||!Object.hasOwn(names,bucket))throw new Error('Sous-stock non autorisé.');
    const rows=entries(operator).map(item=>({label:item.label,type:item.type||'',qty:quantities(item)[bucket]})).filter(r=>r.qty>0).sort((a,b)=>String(a.label).localeCompare(String(b.label),'fr'));
    const now=new Date(),date=now.toLocaleString('fr-FR'),total=rows.reduce((sum,r)=>sum+r.qty,0);
    const filename=`${operator}-${bucket}-${now.toISOString().slice(0,10)}`.replace(/[^a-zA-Z0-9_-]/g,'_');
    if(format==='excel'){
      const x=global.XLSX;if(!x)throw new Error('Le module Excel est indisponible. Rechargez la page.');
      const book=x.utils.book_new();
      const sheet=x.utils.aoa_to_sheet([
        ['Stock',operator],['Sous-stock',names[bucket]],['Date',date],[],
        ['Matériel','Type','Quantité disponible'],...rows.map(r=>[r.label,r.type,r.qty]),
        [],['TOTAL','',total],
      ]);
      sheet['!cols']=[{wch:48},{wch:28},{wch:22}];
      x.utils.book_append_sheet(book,sheet,'Sous-stock');x.writeFile(book,filename+'.xlsx');
    }else if(format==='pdf'){
      if(!global.jspdf?.jsPDF)throw new Error('Le module PDF est indisponible. Rechargez la page.');
      const doc=new global.jspdf.jsPDF();
      doc.setFontSize(17);doc.text(names[bucket],14,20);
      doc.setFontSize(10);doc.text(`Stock : ${operator}`,14,29);doc.text(`Date : ${date}`,14,36);
      doc.autoTable({startY:44,head:[['Matériel','Type','Quantité disponible']],body:rows.map(r=>[r.label,r.type,String(r.qty)]),foot:[['TOTAL','',String(total)]],showFoot:'lastPage',styles:{fontSize:9,overflow:'linebreak'},headStyles:{fillColor:[30,64,175]},columnStyles:{2:{halign:'right'}}});
      if(!rows.length)doc.text('Aucun article disponible dans ce sous-stock.',14,75);
      doc.save(filename+'.pdf');
    }
  }
  async function open(operator){
    if(!owns(operator))return;
    const modal=document.createElement('dialog');modal.className='substock-dialog';
    modal.innerHTML='<p>Chargement des sous-stocks…</p>';document.body.append(modal);modal.showModal();
    modal.onclose=()=>{modal.remove();env.onClose?.();};modal.oncancel=e=>{if(busy)e.preventDefault();};
    let filter='all';
    const draw=()=>{
      if(!modal.isConnected)return;
      const all=entries(operator),totals=Object.fromEntries(Object.keys(names).map(k=>[k,all.reduce((sum,s)=>sum+quantities(s)[k],0)]));
      const rows=all.filter(s=>filter==='all'||quantities(s)[filter]>0);
      modal.innerHTML=`<header><div><p>GESTIONNAIRE BUREAU 02</p><h2>${esc(operator)} · Sous-stocks</h2></div><button type="button" data-close aria-label="Fermer">Fermer</button></header><p>Répartissez les quantités existantes sans changer le stock total. Pour les bons de sortie, choisissez les sous-stocks et les quantités à prélever.</p><div class="substock-cards">${Object.entries(names).map(([k,name])=>`<button data-filter="${k}" style="--substock-color:${colors[k]}" aria-pressed="${filter===k}"><span>${name}</span><strong>${totals[k]}</strong><small>Voir les articles</small></button>`).join('')}</div><div class="substock-toolbar"><button data-filter="all">Tous les articles (${all.length})</button><span>Stock total : ${all.reduce((sum,s)=>sum+Number(s.qty||0),0)}</span></div>${filter!=='all'?`<div class="substock-exports"><strong>${names[filter]}</strong><button type="button" data-substock-export="excel">Exporter Excel</button><button type="button" data-substock-export="pdf">Exporter PDF</button></div>`:''}<p data-status role="status"></p><div class="substock-items">${rows.map((s,index)=>{const q=quantities(s);return `<details><summary><b>${esc(s.label)}</b><span>${s.qty} au total · ${q.unallocated} à répartir</span></summary><form data-index="${index}"><p>Indiquez la quantité totale souhaitée dans chaque sous-stock. Le reste demeure à répartir.</p><div class="substock-fields">${Object.entries(names).filter(([k])=>k!=='unallocated').map(([k,name])=>`<label>${name}<input type="number" name="${k}" min="0" step="any" required max="${Number(s.qty)}" value="${q[k]}"></label>`).join('')}</div><button type="submit">Enregistrer la répartition</button></form></details>`;}).join('')||'<p>Aucun article dans ce sous-stock.</p>'}</div>`;
      modal.querySelector('[data-close]').onclick=()=>{if(!busy)modal.close();};
      modal.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{if(!busy){filter=b.dataset.filter;draw();}});
      modal.querySelectorAll('[data-substock-export]').forEach(b=>b.onclick=()=>{if(busy)return;try{exportSubstock(operator,filter,b.dataset.substockExport);}catch(error){modal.querySelector('[data-status]').textContent=error.message;}});
      modal.onsubmit=async e=>{
        e.preventDefault();if(busy)return;const form=e.target,item=rows[Number(form.dataset.index)],values=new FormData(form);
        const buckets=Object.fromEntries(['production','deploiement','maintenance'].map(k=>[k,Number(values.get(k))]));
        if(Object.values(buckets).some(n=>!Number.isFinite(n)||n<0)||Object.values(buckets).reduce((a,b)=>a+b,0)>Number(item.qty)){modal.querySelector('[data-status]').textContent='La somme doit être inférieure ou égale au stock total.';return;}
        busy=true;modal.querySelectorAll('button,input').forEach(b=>b.disabled=true);
        try{await rpc('reorganize_stock_substocks',{stock_key:item._dbKey,expected:item,buckets});await env.refresh();draw();modal.querySelector('[data-status]').textContent='Répartition enregistrée.';}
        catch(error){modal.querySelector('[data-status]').textContent=error.message;}
        finally{busy=false;modal.querySelectorAll('button,input').forEach(b=>b.disabled=false);}
      };
    };
    try{await env.refresh();draw();}catch(error){modal.textContent=error.message;const close=document.createElement('button');close.textContent='Fermer';close.onclick=()=>modal.close();modal.append(close);}
  }
  global.StockSubstocks={setup:config=>{env=config;},enabled,owns,quantities,open,receptionField,receive,pickerRows,pickerHtml,chooseIssue,exportSubstock};
})(window);
