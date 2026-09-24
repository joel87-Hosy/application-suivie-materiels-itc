(function(global){
  'use strict';
  const label=v=>String(v||'').normalize('NFC').trim().replace(/\s+/g,' ').toUpperCase();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function bounds(period,anchor){
    const start=new Date(anchor+'T00:00:00');
    if(!Number.isFinite(+start))return null;
    if(period==='week')start.setDate(start.getDate()-(start.getDay()+6)%7);
    if(period==='month')start.setDate(1);
    if(period==='year'){start.setMonth(0,1);}
    const end=new Date(start);
    if(period==='year')end.setFullYear(end.getFullYear()+1);
    else if(period==='month')end.setMonth(end.getMonth()+1);
    else end.setDate(end.getDate()+(period==='week'?7:1));
    return {start:+start,end:+end};
  }
  function collect(data,profile,uid,op,timestamp,itemsFor=r=>r.items||[]){
    const allowed=new Set(Object.keys(profile.controlScopes||{}).filter(k=>profile.controlScopes[k]===true).map(op));
    const sameCompany=r=>!r.company_id||r.company_id===profile.company_id;
    const own=r=>r.actorUid? [uid,profile.uid].includes(r.actorUid):r.validatedById!=null?String(r.validatedById)===String(profile.id):r.assignedGestionnaireUid?r.assignedGestionnaireUid===uid:true;
    const materials=new Map();
    const material=name=>{const key=label(name);if(!materials.has(key))materials.set(key,{designation:key,stock:0,type:'',movements:[]});return materials.get(key);};
    for(const s of data.stock||[])if(sameCompany(s)&&allowed.has(op(s.op))&&label(s.label)){const m=material(s.label);m.stock+=Number(s.qty)||0;m.type=s.type||m.type;}
    const seen=new Set();
    const add=(record,item,type,id,date)=>{
      const stock=op(item.op||record.op),qty=Number(item.qty),name=label(item.label);
      if(!name||!allowed.has(stock)||!Number.isFinite(qty)||qty<=0)return;
      const key=JSON.stringify([type,id,stock,name]);
      const m=material(name),existing=m.movements.find(v=>v.key===key);
      if(existing){existing.qty+=qty;return;}
      m.movements.push({key,operation:id,type,date,ts:timestamp(date),qty,op:stock,ref:record.ref||record.reference||record.id||record._dbKey||'—'});
    };
    for(const [index,r] of (data.stockMovements||[]).entries()){
      if(!sameCompany(r)||!own(r)||r.type!=='in'||r.movementKind==='TRANSFERT_ENTREE'||(r.source&&r.source!=='reception'))continue;
      const id=r._dbKey||r.id||'receipt-'+index;if(seen.has('in:'+id))continue;seen.add('in:'+id);
      add(r,r,'ENTREE',id,r.createdAt||r.date);
    }
    const outputs=data.sorties||[];
    for(const [index,r] of outputs.entries()){
      if(!sameCompany(r)||!own(r)||r.type==='TRANSFERT'||(r.status&&r.status!=='LIVREE'))continue;
      const id=r._dbKey||r.id||'output-'+index;if(seen.has('out:'+id))continue;seen.add('out:'+id);
      for(const item of itemsFor(r))add(r,item,'SORTIE',id,r.validatedAt||r.dateLivraison||r.date);
    }
    // Legacy delivered requests without an associated output are still physical issues.
    for(const [index,r] of (data.demandes||[]).entries()){
      if(!sameCompany(r)||!own(r)||r.status!=='LIVREE')continue;
      if(outputs.some(s=>sameCompany(s)&&((r.sortieId&&(s.id===r.sortieId||s._dbKey===r.sortieId))||(r.id&&s.sourceDemandeId===r.id))))continue;
      for(const item of r.items||[])add(r,item,'SORTIE',r._dbKey||r.id||'request-'+index,r.validatedAt||r.dateLivraison||r.date);
    }
    return [...materials.values()].sort((a,b)=>a.designation.localeCompare(b.designation,'fr'));
  }
  let env,period='month',anchor='',selected=null,container;
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function snapshot(){
    const range=bounds(period,anchor||today());
    return collect(env.data(),env.profile(),env.uid(),env.op,env.timestamp,env.itemsFor).map(m=>({...m,movements:m.movements.filter(v=>range&&v.ts>=range.start&&v.ts<range.end).sort((a,b)=>b.ts-a.ts)}));
  }
  const quantity=(m,type)=>m.movements.filter(v=>v.type===type).reduce((sum,v)=>sum+v.qty,0);
  const count=(m,type)=>new Set(m.movements.filter(v=>v.type===type).map(v=>v.operation)).size;
  function table(m,type){const rows=m.movements.filter(v=>v.type===type);return `<details data-details="${type}" class="bg-white border rounded-xl p-4"><summary class="cursor-pointer font-bold">${type==='ENTREE'?'Détails des entrées':'Détails des sorties'} (${count(m,type)})</summary><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr><th>Date</th><th>Quantité</th><th>${type==='ENTREE'?'Stock destinataire':'Stock déduit'}</th><th>Référence</th></tr></thead><tbody>${rows.map(r=>`<tr class="border-t"><td class="p-3">${esc(new Date(r.ts).toLocaleString('fr-FR'))}</td><td>${r.qty}</td><td>${esc(r.op)}</td><td>${esc(r.ref)}</td></tr>`).join('')||'<tr><td colspan="4" class="p-4">Aucun mouvement sur cette période.</td></tr>'}</tbody></table></div></details>`;}
  function render(target,designation=null){
    container=target;selected=designation;anchor||=today();
    const rows=snapshot(),m=rows.find(r=>r.designation===selected);
    const card=(item,type,color)=>`<button type="button" data-kind="${type}" class="bg-${color}-50 border rounded-xl p-4"><span class="block font-bold">Total ${type==='ENTREE'?'entrées':'sorties'}</span><strong class="block text-2xl">${count(item,type)}</strong><span>opération(s)</span><span class="block font-bold mt-2">Quantité totale : ${quantity(item,type)}</span><span class="block">Voir les détails</span></button>`;
    container.innerHTML=`<div class="manager-flux p-4 space-y-5"><h2 class="text-xl font-bold">Flux matériels${m?' : '+esc(m.designation):''}</h2><div class="flex flex-wrap gap-3"><label>Période <select data-period class="border p-2">${[['day','Jour'],['week','Semaine'],['month','Mois'],['year','Année']].map(([v,t])=>`<option value="${v}" ${v===period?'selected':''}>${t}</option>`).join('')}</select></label><label>Date de référence <input data-date type="date" value="${anchor}" class="border p-2"></label><button data-refresh class="border p-2">Actualiser</button><button data-export="pdf" class="border p-2">PDF</button><button data-export="xlsx" class="border p-2">Excel</button></div><p>Les compteurs indiquent le nombre d’opérations et la quantité totale de matériel sur la période. Les semaines vont du lundi au dimanche. Le stock actuel est la quantité disponible aujourd’hui.</p>${m?`<button data-back class="text-blue-700">Retour aux matériels</button><p>Type de matériel : ${esc(m.type||'Non renseigné')}</p><div class="grid md:grid-cols-3 gap-4">${card(m,'ENTREE','green')}${card(m,'SORTIE','red')}<div class="bg-cyan-50 border rounded-xl p-4">Stock actuel<strong class="block text-2xl">${m.stock}</strong></div></div>${table(m,'ENTREE')}${table(m,'SORTIE')}`:`<div class="grid md:grid-cols-3 gap-4">${rows.map((r,i)=>`<button data-material="${i}" class="bg-white border rounded-xl p-4 text-left"><b>${esc(r.designation)}</b><p>Entrées : ${count(r,'ENTREE')} opération(s) · Quantité totale : ${quantity(r,'ENTREE')}</p><p>Sorties : ${count(r,'SORTIE')} opération(s) · Quantité totale : ${quantity(r,'SORTIE')}</p><p>Stock actuel : ${r.stock}</p></button>`).join('')||'<p>Aucun matériel dans vos stocks.</p>'}</div>`}</div>`;
    container.querySelector('[data-period]').onchange=e=>{period=e.target.value;render(container,selected);};
    container.querySelector('[data-date]').onchange=e=>{if(bounds(period,e.target.value)){anchor=e.target.value;render(container,selected);}};
    container.querySelector('[data-refresh]').onclick=async e=>{e.target.disabled=true;try{await env.refresh();render(container,selected);}catch(error){global.alert(error.message);}finally{e.target.disabled=false;}};
    container.querySelectorAll('[data-material]').forEach(b=>b.onclick=()=>render(container,rows[Number(b.dataset.material)].designation));
    container.querySelector('[data-back]')?.addEventListener('click',()=>render(container));
    container.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{const detail=container.querySelector(`[data-details="${b.dataset.kind}"]`);detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'nearest'});});
    container.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportFile(b.dataset.export,selected));
  }
  async function exportFile(format,designation){
    const rows=snapshot().filter(m=>!designation||m.designation===designation);
    const summary=rows.map(m=>({'Matériel':m.designation,'Nombre d’entrées':count(m,'ENTREE'),'Quantité entrée':quantity(m,'ENTREE'),'Nombre de sorties':count(m,'SORTIE'),'Quantité sortie':quantity(m,'SORTIE'),'Stock actuel':m.stock}));
    const movements=rows.flatMap(m=>m.movements.map(v=>({'Matériel':m.designation,Type:v.type,Date:new Date(v.ts).toLocaleString('fr-FR'),'Quantité':v.qty,Stock:v.op,'Référence':v.ref})));
    if(format==='xlsx'){const book=global.XLSX.utils.book_new();for(const [title,values] of [['Totaux',summary],['Mouvements',movements]])global.XLSX.utils.book_append_sheet(book,global.XLSX.utils.json_to_sheet(values),title);global.XLSX.writeFile(book,`Flux-${period}-${anchor}.xlsx`);}
    else {const doc=new global.jspdf.jsPDF({orientation:'landscape'});doc.text(`Flux materiels - ${period} - ${anchor}`,14,15);for(const [i,values] of [summary,movements].entries()){if(i)doc.addPage();const keys=Object.keys(values[0]||{});doc.autoTable({startY:25,head:[keys],body:values.map(v=>keys.map(k=>String(v[k])))});}doc.save(`Flux-${period}-${anchor}.pdf`);}
  }
  global.ManagerFlux={collect,bounds,setup:config=>{env=config;},render,exportFile};
})(typeof window==='undefined'?globalThis:window);
