(function(global){
  'use strict';
  const stocks=['ITC-B01','ITC-B02','OCI','CIC','MOOV','MTN','ITC-BOUAKE','ITC-SAN-PEDRO','ITC-YAMOUSSOUKRO'];
  const names={'ITC-BOUAKE':'ITC Bouaké','ITC-SAN-PEDRO':'ITC San-Pédro','ITC-YAMOUSSOUKRO':'ITC Yamoussoukro'};
  function validateManagerStocks(role,ops) {
    if(role==='Gestionnaire' && ops.includes('ITC-B02') && ops.some(op=>Object.hasOwn(names,op)))throw Error('Le bureau 02 peut déjà consulter et alimenter les trois villes. Affectez la modification de ces stocks à leurs gestionnaires locaux, sans les cocher pour le bureau 02.');
  }
  const selector=(selected=[])=>`<fieldset id="cu-stock-selection" class="border rounded-xl p-3 space-y-2"><legend class="text-xs font-bold">Stocks dédiés</legend>${stocks.map(op=>`<label class="flex items-center gap-2 text-xs"><input type="checkbox" name="managedOps" value="${op}" ${selected.includes(op)?'checked':''}>${names[op]||op}</label>`).join('')}<p class="text-xs text-slate-500">Gestionnaire ou validateur : choisissez au moins un stock. Contrôleur : accès à tous les stocks de l’entreprise.</p></fieldset>`;
  async function create(event){
    event.preventDefault();if(!isCurrentCompanySupervisor())return;
    const button=event.submitter||event.target.querySelector('button[type=submit]');if(button)button.disabled=true;
    try{
      const companyId=isCurrentSuperAdmin()?getFormTextValue('cu-company-id'):secureStore.profile.company_id;
      const role=document.getElementById('cu-user-role').value;
      const affiliation=global.AccountAffiliation.values(event.target,role);
      const managedOps=role==='Contrôleur'?[]:Array.from(event.target.querySelectorAll('[name=managedOps]:checked'),el=>el.value);
      validateManagerStocks(role,managedOps);
      if(['Gestionnaire','Validateur','Validatrice'].includes(role)&&!managedOps.length)throw Error('Sélectionnez au moins un stock dédié.');
      const email=getFormTextValue('cu-user-email').toLowerCase(),password=getFormTextValue('cu-temp-password');
      const config=global.ITCSupabaseConfig;
      const {data,error}=await config.client.auth.getSession();if(error||!data.session)throw Error('Reconnectez-vous pour créer ce compte.');
      const response=await fetch(config.projectUrl+'/functions/v1/company-users',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({companyId,role,managedOps,email,password,...affiliation,name:getFormTextValue('cu-user-name')})});
      const result=await response.json();if(!response.ok||result.error)throw Error(result.error||'Création du compte impossible.');
      alert(`Compte créé.\nEmail : ${email}\nMot de passe temporaire : ${password}\nStocks : ${managedOps.join(', ')||'Selon le rôle'}`);
      await refreshAppDataFromServer();renderCompanyUsersAdmin(document.getElementById('app-container'));
    }catch(error){alert('Création refusée : '+error.message);}finally{if(button)button.disabled=false;}
  }
  async function edit(userId){
    if(!isCurrentCompanySupervisor())return;
    const user=(appData.users||[]).find(u=>String(u.id)===String(userId));if(!user||user.role!=='Gestionnaire')return;
    const modal=document.createElement('dialog');modal.className='rounded-2xl p-6 max-w-lg';
    modal.innerHTML=`<form class="space-y-4"><h3 class="font-bold">Stocks dédiés du gestionnaire</h3>${selector(ControlCore.scopes(user.controlScopes||user.managedOps))}<p role="status"></p><button type="submit" class="bg-teal-700 text-white p-3 rounded-xl">Enregistrer</button><button type="button" class="p-3">Annuler</button></form>`;
    document.body.append(modal);modal.querySelector('[type=button]').onclick=()=>modal.close();modal.onclose=()=>modal.remove();
    modal.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=modal.querySelector('[type=submit]');button.disabled=true;try{
      const ops=Array.from(modal.querySelectorAll('[name=managedOps]:checked'),el=>el.value);if(!ops.length)throw Error('Sélectionnez au moins un stock.');
      validateManagerStocks('Gestionnaire',ops);
      const {error}=await global.ITCSupabaseConfig.client.rpc('assign_manager_stocks',{target_uid:user.uid,stock_ops:ops});if(error)throw error;
      await refreshAppDataFromServer();modal.close();renderCompanyUsersAdmin(document.getElementById('app-container'));
    }catch(error){modal.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}};
    modal.showModal();
  }
  let managing=false;
  const operations=new Map();
  async function manage(userId,action){
    if(managing||!isCurrentCompanySupervisor())return;
    const user=(appData.users||[]).find(u=>String(u.id)===String(userId));
    const labels={suspend:'suspendre',disable:'désactiver',activate:'réactiver',delete:'supprimer définitivement'};
    if(!user||!labels[action])return;
    if(String(user.id)===String(currentUser.id))return alert('Vous ne pouvez pas modifier votre propre compte.');
    if(!confirm(`Voulez-vous ${labels[action]} le compte ${user.name||user.email} ?${action==='delete'?' Les bons et historiques seront conservés.':''}`))return;
    const key=user.uid+'|'+action;
    if(!operations.has(key))operations.set(key,global.crypto.randomUUID());
    managing=true;
    const buttons=Array.from(document.querySelectorAll('#app-container button')).filter(b=>!b.disabled);buttons.forEach(b=>b.disabled=true);
    try{
      const config=global.ITCSupabaseConfig;
      const {data,error}=await config.client.auth.getSession();if(error||!data.session)throw Error('Reconnectez-vous pour gérer ce compte.');
      const response=await fetch(config.projectUrl+'/functions/v1/company-users',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action,targetUid:user.uid,companyId:user.company_id,operationId:operations.get(key)})});
      const result=await response.json();
      // Old deployments only implement account creation and reject a delete
      // request as a missing creation role. Do not misreport the actor's rights.
      if(result.error==='Rôle non autorisé.')throw Error('Le serveur Supabase utilise encore une ancienne version de la gestion des comptes. Le rôle Superviseur est autorisé, mais la fonction company-users doit être mise à jour pour permettre cette action.');
      if(!response.ok||result.error)throw Error(result.error||'Action refusée.');
      if(result.updated!==true||result.action!==action)throw Error('Le serveur n’a pas confirmé cette action. Mettez à jour la fonction Supabase company-users, puis réessayez.');
      operations.delete(key);
      await refreshAppDataFromServer({render:false});
      if(currentSectionId==='company-users')renderCompanyUsersAdmin(document.getElementById('app-container'));
      alert('Compte mis à jour dans Supabase.');
    }catch(error){alert(error.message);}finally{managing=false;buttons.forEach(b=>b.disabled=false);}
  }
  global.CompanyUsers={stocks,names,selector,create,edit,manage};
})(window);
