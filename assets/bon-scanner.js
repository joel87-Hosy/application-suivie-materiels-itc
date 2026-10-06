(function(global){
  'use strict';
  let env,camera=null,generation=0,busy=false,stopping=Promise.resolve(),activePdfUrl=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('fr-FR'):'Non renseignée';
  function historyHtml(rows){return `<h3 class="font-bold">Scans du jour (heure UTC)</h3>${(rows||[]).map(r=>`<p>${esc(r.heure)} · ${esc(r.technicien)} · ${esc(r.id)} · ${esc(r.state||'Contrôlé')}</p>`).join('')||'<p>Aucun scan aujourd’hui.</p>'}`;}
  function code(record,data){const bon=global.BonReference.resolve(record,data);return 'ITC-BON:1:'+encodeURIComponent(bon.company_id||record.company_id||'')+':'+encodeURIComponent(bon.sourceDemandeId||bon.id||bon._dbKey||'');}
  function parse(value,company){
    const text=String(value||'').trim();
    if(text.startsWith('ITC-BON:')){
      const parts=text.split(':');
      if(parts.length!==4||parts[1]!=='1')throw Error('Format de QR code non reconnu.');
      if(decodeURIComponent(parts[2])!==company)throw Error('Ce bon appartient à une autre entreprise.');
      const id=decodeURIComponent(parts[3]);if(!id||id.length>250)throw Error('Identifiant invalide.');return id;
    }
    if(!text||text.length>250)throw Error('Identifiant invalide.');return text;
  }
  function stockFor(item,bon){
    const stock=env?.data?.()?.stock||[],op=String(item?.op||bon?.op||'').trim().toUpperCase();
    const label=String(item?.label||'').trim().replace(/\s+/g,' ').toUpperCase();
    const key=String(item?.stockKey||item?._dbKey||'');
    return stock.find(row=>(!key||String(row._dbKey||row.id||'')===key)&&String(row.op||row.operator||'').trim().toUpperCase()===op&&String(row.label||row.name||row.designation||'').trim().replace(/\s+/g,' ').toUpperCase()===label);
  }
  async function pdf(doc,record,data,y){
    const bon=global.BonReference.resolve(record,data);
    if(!(bon.sourceDemandeId||bon.id||bon._dbKey)||!bon.company_id)throw Error('Identité du bon incomplète : QR code impossible. Actualisez les données.');
    const holder=document.createElement('div');
    holder.style.cssText='position:fixed;left:-10000px;top:0;';document.body.append(holder);
    try{
      new global.QRCode(holder,{text:code(record,data),width:256,height:256,correctLevel:global.QRCode.CorrectLevel.M});
      const canvas=holder.querySelector('canvas');
      if(!canvas)throw Error('Impossible de générer le QR code du bon.');
      doc.addImage(canvas.toDataURL('image/png'),'PNG',14,y,28,28);
      doc.setFontSize(8);
      const lines=[`Enregistre le : ${date(bon.bonCreatedAt||bon.createdAt||bon.date)}`,
        bon.bonValidUntil?`Valable jusqu'au : ${date(bon.bonValidUntil)}`:'Validite a verifier en ligne au magasin.',
        'Validite initiale : 24 heures. Apres validation du gestionnaire, le magasinier peut servir le bon.',
        'Le statut serveur et le suivi des articles font foi au magasin.',
        'Un bon deja livre ne permet aucune nouvelle remise.'];
      doc.text(lines,47,y+4,{maxWidth:148});
      return y+34;
    }finally{holder.remove();}
  }
  function stop(){
    generation++;busy=false;
    const previous=camera;camera=null;if(activePdfUrl){URL.revokeObjectURL(activePdfUrl);activePdfUrl=null;}
    if(previous)stopping=stopping.catch(()=>{}).then(async()=>{try{if(previous.isScanning)await previous.stop();}catch(_){}try{previous.clear();}catch(_){}});
    return stopping;
  }
  async function rpc(name,args){const {data,error}=await env.client().rpc(name,args);if(error)throw Error(error.code==='PGRST202'&&name==='inspect_stock_bon'?'Le serveur Supabase ne connaît pas encore le contrôle du scanner. L’administrateur doit appliquer la migration supabase/migrations/202610010002_storekeeper_issue_workflow.sql, puis recharger le schéma API. Aucune remise n’a été effectuée.':error.message);return data;}
  async function scan(value,container=document.getElementById('app-container')){
    if(busy)return;
    const token=generation,profile=env.profile(),uid=profile?.uid;
    if(profile?.role!=='Magasinier')return;
    busy=true;
    const output=container.querySelector('[data-scan-result]');if(!output){busy=false;return;}
    output.innerHTML='<p role="status">Vérification du bon dans la base…</p>';
    const valid=()=>token===generation&&env.profile()?.uid===uid&&container.isConnected;
    try{
      const id=parse(value,profile.company_id);
      const check=await rpc('inspect_stock_bon',{bon_id:id});
      if(!valid())return;
      const bon=check.bon;
      const history=container.querySelector('[data-scan-history]');if(history)history.innerHTML=historyHtml(check.scansToday);
      const labels={VALIDE:'BON PRET A SERVIR',EXPIRE:'BON EXPIRE',DEJA_LIVRE:'BON ENTIEREMENT SERVI',A_VALIDER:'EN ATTENTE DU DEBIT DU GESTIONNAIRE',REFUSE:'BON REFUSE OU ANNULE'};
      const material=bon.materialService||{},servedMap=material.servedByItem||{},events=material.events||[];
      const serveRows=(bon.items||[]).map((item,index)=>{
        const progress=servedMap[String(index)]||{},served=Number(progress.qty||0),remaining=Math.max(0,Number(item.qty||0)-served);
        if(remaining<=0||material.unavailableByItem?.[String(index)])return '';
        const servedBy=events.filter(event=>(event.items||[]).some(line=>Number(line.index)===index)).map(event=>event.name).filter(Boolean).join(', ');
        const stock=stockFor(item,bon),available=Math.max(0,Number(stock?.qty||0)),cap=bon.managerDebitAt?remaining:Math.min(remaining,available);
        return `<div class="space-y-2 border rounded-xl p-3"><div class="grid grid-cols-[auto_1fr_100px] gap-3 items-center"><input type="checkbox" data-serve-index="${index}"><span><b>${esc(item.label)}</b><small class="block">${esc(item.op||bon.op)} | demande ${esc(item.qty)} | deja servi ${esc(served)} | reste ${esc(remaining)} | ${bon.managerDebitAt?'debite par le gestionnaire':`stock ${stock?esc(available):'absent'}`}${servedBy?` | par ${esc(servedBy)}`:''}</small></span><input type="number" data-serve-qty="${index}" min="0" max="${cap}" step="any" value="${cap}" disabled class="border rounded p-2 w-full" aria-label="Quantite a servir"></div>${cap<remaining&&!bon.managerDebitAt?`<label class="block"><input type="checkbox" data-unavailable-index="${index}"> Materiel indisponible pour le reliquat (${esc(remaining-cap)} restant)</label>`:''}</div>`;
      }).join('');
      if(activePdfUrl)URL.revokeObjectURL(activePdfUrl);activePdfUrl=null;
      try{if(global.generateSignedBonPdf){activePdfUrl=URL.createObjectURL(await global.generateSignedBonPdf(bon));}}catch(pdfError){console.warn('PDF du bon indisponible',pdfError);}
      const color=check.canIssue?'border-green-600 bg-green-50':'border-red-600 bg-red-50';
      output.innerHTML=`<section class="border-2 ${color} p-5 rounded-2xl space-y-3"><h3 class="font-black">${labels[check.state]||'BON NON AUTORISE'}</h3>
        <p><b>Reference :</b> ${esc(global.BonReference.format(bon))}</p><p><b>Destinataire / equipe :</b> ${esc(bon.equipe||bon.demandeurName||bon.tech)}</p><p><b>Motif :</b> ${esc(bon.motif||bon.ref)}</p>
        <p><b>Statut :</b> ${esc(bon.status||bon.statut)}</p><p><b>Validateur :</b> ${esc(bon.validatorDecision?.name||'En attente')} · <b>Gestionnaire :</b> ${esc(bon.assignedGestionnaireName||'Non renseigne')}</p>
        ${check.state==='DEJA_LIVRE'?`<p><b>Termine le :</b> ${esc(date(check.deliveredAt))} · <b>Par :</b> ${esc(check.deliveredBy||'')}</p>`:''}
        ${activePdfUrl?`<div><a class="inline-block bg-indigo-700 text-white rounded-lg p-3" href="${activePdfUrl}" target="_blank" rel="noopener">Ouvrir / télécharger le PDF du bon</a><iframe title="PDF du bon" src="${activePdfUrl}" class="w-full h-[65vh] border rounded-xl mt-3"></iframe></div>`:'<p class="text-amber-800">Le PDF du bon est indisponible. Les articles restent consultables ci-dessous.</p>'}
        <section class="space-y-2"><h4 class="font-bold">Articles et suivi du service</h4>${serveRows||'<p>Aucun article sur ce bon.</p>'}</section>
        ${global.BonSignatures.html(bon)}
        ${check.canIssue?`<form data-serve-form class="space-y-3"><p class="font-bold">Confirmez les quantites physiquement remises. Le stock a deja ete debite par le gestionnaire.</p><label class="block">Nom et signature du magasinier<textarea data-signer name="signer" required maxlength="120" class="border rounded-xl p-3 w-full" placeholder="Nom complet"></textarea></label><button class="bg-green-700 text-white p-3 rounded-xl">Signer et valider le service</button></form>`:''}
        <p>Controle serveur : ${esc(date(check.checkedAt))}. Le stock a ete debite lors de la signature du gestionnaire; votre signature enregistre uniquement la remise.</p>
        <button data-recheck class="border p-3 rounded-xl">Actualiser le suivi du bon</button><p data-action-status role="status"></p></section>`;
      output.querySelector('[data-recheck]').onclick=()=>scan(value,container);
      output.querySelectorAll('[data-serve-index]').forEach(input=>input.onchange=()=>{const qty=output.querySelector(`[data-serve-qty="${input.dataset.serveIndex}"]`);if(qty)qty.disabled=!input.checked;});
      output.querySelectorAll('[data-unavailable-index]').forEach(input=>input.onchange=()=>{const qty=output.querySelector(`[data-serve-qty="${input.dataset.unavailableIndex}"]`),serve=output.querySelector(`[data-serve-index="${input.dataset.unavailableIndex}"]`);if(input.checked&&serve&&!serve.checked){serve.checked=true;if(qty)qty.value=qty.max;}if(qty)qty.disabled=!serve?.checked;});
      output.querySelector('[data-serve-form]')?.addEventListener('submit',async event=>{
        event.preventDefault();if(busy||!valid())return;
        const selected=Array.from(output.querySelectorAll('[data-serve-index]:checked'),checkBox=>({index:Number(checkBox.dataset.serveIndex),quantity:Number(output.querySelector(`[data-serve-qty="${checkBox.dataset.serveIndex}"]`).value)})).filter(row=>row.quantity>0);
        const unavailable_items=Array.from(output.querySelectorAll('[data-unavailable-index]:checked'),input=>Number(input.dataset.unavailableIndex));
        if(!selected.length&&!unavailable_items.length){output.querySelector('[data-action-status]').textContent='Sélectionnez une quantité à servir ou un article indisponible.';return;}
        busy=true;const button=event.target.querySelector('button');button.disabled=true;
        try{
          const signature=await global.BonSignatures.capture('Signature du magasinier — service des articles',event.target.elements.signer.value||profile.name||'');
          if(!signature||!valid())return;
          await rpc('dispense_stock_bon_signed_v2',{request_key:check.requestKey,items:selected,unavailable_items,signer_name:signature.name,signature_image:signature.image});
          if(valid()){busy=false;await scan(value,container);}
        }catch(error){if(valid())output.querySelector('[data-action-status]').textContent=error.message;}
        finally{busy=false;if(valid()&&button.isConnected)button.disabled=false;}
      });      const sound=document.getElementById('beep-sound');try{sound?.play()?.catch(()=>{});if(navigator.userActivation?.hasBeenActive)navigator.vibrate?.(100);}catch(_){}
    }catch(e){if(valid())output.innerHTML=`<p class="bg-red-50 text-red-800 p-5 rounded-xl" role="alert">${esc(e.message)} Aucune remise autorisée sans contrôle serveur.</p>`;}
    finally{if(token===generation)busy=false;}
  }
  async function enter(container){
    const pending=stop(),token=generation;await pending;if(token!==generation)return;
    if(env.profile()?.role!=='Magasinier'){container.textContent='Scanner réservé au magasinier.';return;}
    container.innerHTML=`<div class="max-w-3xl mx-auto space-y-5 p-4"><h2 class="font-black text-xl">Service des bons au magasin</h2><p>Scannez le QR code du bon validé par le gestionnaire. Les articles déjà servis sont affichés et les articles restants peuvent être servis.</p><div id="bon-reader"></div><button data-camera class="bg-indigo-700 text-white p-3 rounded-xl">Activer la caméra</button><button data-camera-stop class="border p-3 rounded-xl">Arrêter la caméra</button><p data-camera-status role="status"></p><form data-manual class="flex gap-2"><input name="code" aria-label="Identifiant ou contenu du QR code" placeholder="Identifiant du bon ou contenu du QR code" required class="border rounded-xl p-3 flex-1 min-w-0"><button class="border p-3 rounded-xl">Vérifier</button></form><div data-scan-result aria-live="polite"></div><section data-scan-history class="bg-slate-50 p-4 rounded-xl">L’historique du jour sera actualisé lors du contrôle d’un bon.</section></div>`;
    container.querySelector('[data-manual]').onsubmit=e=>{e.preventDefault();scan(e.target.elements.code.value,container);};
    container.querySelector('[data-camera-stop]').onclick=async()=>{if(camera?.isScanning)await camera.stop();};
    container.querySelector('[data-camera]').onclick=async()=>{
      const button=container.querySelector('[data-camera]'),status=container.querySelector('[data-camera-status]');
      if(camera?.isScanning)return;button.disabled=true;status.textContent='Ouverture de la caméra…';
      let instance;
      try{
        if(!global.Html5Qrcode)throw Error('Lecteur caméra indisponible. Rechargez la page ou saisissez l’identifiant.');
        instance=new global.Html5Qrcode('bon-reader');camera=instance;let detected=false;
        await instance.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},async text=>{
          if(detected||token!==generation)return;detected=true;
          try{await instance.stop();}catch(_){}
          if(token===generation)await scan(text,container);
        });
        if(token!==generation){if(instance.isScanning)await instance.stop();return;}
        status.textContent='Présentez le QR code du bon.';
      }catch(e){if(token===generation)status.textContent='Caméra inaccessible : '+e.message;}
      finally{button.disabled=false;}
    };
  }
  global.BonScanner={setup:config=>{env=config;},enter,scan,stop,pdf,code,parse,date};
})(window);
