(function(global){
  'use strict';
  let env,camera=null,generation=0,busy=false,stopping=Promise.resolve();
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
        'Validite : 24 heures. Apres expiration : confirmation du validateur.',
        'Scanner obligatoire au magasin : le statut serveur fait foi.',
        'Un bon deja livre ne permet aucune nouvelle remise.'];
      doc.text(lines,47,y+4,{maxWidth:148});
      return y+34;
    }finally{holder.remove();}
  }
  function stop(){
    generation++;busy=false;
    const previous=camera;camera=null;
    if(previous)stopping=stopping.catch(()=>{}).then(async()=>{try{if(previous.isScanning)await previous.stop();}catch(_){}try{previous.clear();}catch(_){}});
    return stopping;
  }
  async function rpc(name,args){const {data,error}=await env.client().rpc(name,args);if(error)throw Error(error.code==='PGRST202'?'Le contrôle des bons doit être activé sur le serveur. Aucune remise autorisée depuis le scanner.':error.message);return data;}
  async function scan(value,container=document.getElementById('app-container')){
    if(busy)return;
    const token=generation,profile=env.profile(),uid=profile?.uid;
    if(profile?.role!=='Gestionnaire')return;
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
      const labels={VALIDE:'BON VALIDE',EXPIRE:'BON EXPIRÉ — REMISE BLOQUÉE',DEJA_LIVRE:'BON DÉJÀ LIVRÉ — NE PAS REMETTRE DE MATÉRIEL',A_VALIDER:'VALIDATION EN ATTENTE — REMISE BLOQUÉE',REFUSE:'BON REFUSÉ OU ANNULÉ — REMISE BLOQUÉE'};
      const color=check.canIssue?'border-green-600 bg-green-50':'border-red-600 bg-red-50';
      output.innerHTML=`<section class="border-2 ${color} p-5 rounded-2xl space-y-3"><h3 class="font-black">${labels[check.state]||'BON NON AUTORISÉ'}</h3>
        <p><b>Référence :</b> ${esc(global.BonReference.format(bon))}</p><p><b>Destinataire / équipe :</b> ${esc(bon.equipe||bon.demandeurName||bon.tech)}</p><p><b>Motif :</b> ${esc(bon.motif||bon.ref)}</p>
        <p><b>Création :</b> ${esc(date(check.createdAt))}</p><p><b>Fin de validité :</b> ${esc(date(check.expiresAt))}</p><p><b>Statut enregistré :</b> ${esc(bon.status||bon.statut)}</p>
        <p><b>Validateur :</b> ${esc(bon.validatorDecision?.name||'En attente')}</p><p><b>Gestionnaire affecté :</b> ${esc(bon.assignedGestionnaireName||'Non renseigné')}</p>
        ${check.state==='DEJA_LIVRE'?`<p><b>Remis le :</b> ${esc(date(check.deliveredAt))}</p><p><b>Remis par :</b> ${esc(check.deliveredBy||'Non renseigné')}</p>`:''}
        <ul>${(bon.items||[]).map(i=>`<li>${esc(i.label)} : ${esc(i.qty)} · ${esc(i.op||bon.op)}</li>`).join('')}</ul>
        ${(bon.bonRenewals||[]).map(r=>`<p>Confirmation ${r.approved===false?'refusée':'accordée'} par ${esc(r.name)} le ${esc(date(r.at))} : ${esc(r.reason)}. Validité : ${esc(date(r.validUntil))}.</p>`).join('')}
        ${check.canIssue?'<button data-issue class="bg-green-700 text-white p-3 rounded-xl">Vérifier et confirmer la remise</button>':''}
        ${check.canRequestRenewal?`<button data-renew class="bg-amber-700 text-white p-3 rounded-xl" ${bon.bonRenewalRequestedAt?'disabled':''}>${bon.bonRenewalRequestedAt?'Confirmation demandée au validateur':'Demander la confirmation du validateur'}</button>`:''}
        ${check.state==='VALIDE'&&!check.canIssue?'<p>Seul le gestionnaire affecté peut remettre ce matériel.</p>':''}
        <p>Contrôle serveur effectué le ${esc(date(check.checkedAt))}. Comparez l’identité du porteur et les articles avec les informations ci-dessus.</p>
        <button data-recheck class="border p-3 rounded-xl">Revérifier ce bon</button><p data-action-status role="status"></p></section>`;
      output.querySelector('[data-recheck]').onclick=()=>scan(value,container);
      output.querySelector('[data-issue]')?.addEventListener('click',async()=>{
        if(busy||!valid())return;busy=true;
        const button=output.querySelector('[data-issue]');button.disabled=true;
        try{
          const latest=await rpc('inspect_stock_bon',{bon_id:id});
          if(!valid())return;
          if(!latest.canIssue){busy=false;await scan(value,container);return;}
          await global.ValidatorWorkflow.issue(latest.bon);
        }catch(e){if(valid())output.querySelector('[data-action-status]').textContent=e.message;}
        finally{busy=false;if(valid())button.disabled=false;}
      });
      output.querySelector('[data-renew]')?.addEventListener('click',async()=>{
        if(busy||!valid())return;busy=true;const button=output.querySelector('[data-renew]');button.disabled=true;
        try{await rpc('request_bon_renewal',{request_key:check.requestKey});busy=false;if(valid())await scan(value,container);}
        catch(e){if(valid()){output.querySelector('[data-action-status]').textContent=e.message;button.disabled=false;}}
        finally{busy=false;}
      });
      const sound=document.getElementById('beep-sound');try{sound?.play()?.catch(()=>{});if(navigator.userActivation?.hasBeenActive)navigator.vibrate?.(100);}catch(_){}
    }catch(e){if(valid())output.innerHTML=`<p class="bg-red-50 text-red-800 p-5 rounded-xl" role="alert">${esc(e.message)} Aucune remise autorisée sans contrôle serveur.</p>`;}
    finally{if(token===generation)busy=false;}
  }
  async function enter(container){
    const pending=stop(),token=generation;await pending;if(token!==generation)return;
    if(env.profile()?.role!=='Gestionnaire'){container.textContent='Scanner réservé au gestionnaire.';return;}
    container.innerHTML=`<div class="max-w-3xl mx-auto space-y-5 p-4"><h2 class="font-black text-xl">Contrôle des bons au magasin</h2><p>Scannez le QR code avant chaque remise. Un bon expire après 24 heures et ne peut servir qu’une fois.</p><div id="bon-reader"></div><button data-camera class="bg-indigo-700 text-white p-3 rounded-xl">Activer la caméra</button><button data-camera-stop class="border p-3 rounded-xl">Arrêter la caméra</button><p data-camera-status role="status"></p><form data-manual class="flex gap-2"><input name="code" aria-label="Identifiant ou contenu du QR code" placeholder="Identifiant du bon ou contenu du QR code" required class="border rounded-xl p-3 flex-1 min-w-0"><button class="border p-3 rounded-xl">Vérifier</button></form><div data-scan-result aria-live="polite"></div><section data-scan-history class="bg-slate-50 p-4 rounded-xl">L’historique du jour sera actualisé lors du contrôle d’un bon.</section></div>`;
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
