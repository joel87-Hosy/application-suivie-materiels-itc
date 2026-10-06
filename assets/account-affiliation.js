(function(global){
  'use strict';
  const offices={B01:'Bureau 01',B02:'Bureau 02',BOUAKE:'Bouaké','SAN-PEDRO':'San-Pédro',YAMOUSSOUKRO:'Yamoussoukro'};
  const services={B2B:'B2B',DEP:'Déploiement',MAIN:'Maintenance'};
  const bureau01Services={PROD:'Production FTTH',MBM:'Maintenance backbone moov',MFTTH:'Maintenance FTTH Moov Client',DR:'Déplacement réseau',MNM:'Maintenance et normalisation MTN',DESS:'Dessaturation',LS:'LS',CIDATA:'Cidata'};
  const concerned=role=>['Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice','Superviseur Terrain','Magasinier'].includes(role);
  const office=user=>user?.office || user?.validationBureau || '';
  const isBureau01=user=>office(user)==='B01'||(!office(user)&&user?.controlScopes?.['ITC-B01']===true&&user?.controlScopes?.['ITC-B02']!==true);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const officeList=user=>user?.offices?.length?user.offices:[office(user)].filter(Boolean);
  const serviceList=user=>user?.services?.length?user.services:[user?.serviceAbbreviation].filter(Boolean);
  const serviceLabel=service=>services[service]||bureau01Services[service]||service;
  const summary=user=>(officeList(user).map(o=>offices[o]||o).join(', ')||'Bureau à renseigner')+(user?.role==='Magasinier'?' · Magasinier':' · '+(serviceList(user).map(serviceLabel).join(', ')||'Service à renseigner'));
  const contactStates=new WeakMap();
  const selectedValues=select=>Array.from(select?.selectedOptions||[],o=>o.value).filter(Boolean);
  function contactOptions(users,roles,selected=[]){
    const chosen=selected.map(String),candidates=users.filter(u=>roles.includes(u.role));
    const options=candidates.map(u=>`<option data-contact data-company="${esc(u.company_id)}" data-active="${u.is_active!==false&&(!u.account_status||u.account_status==='active')}" data-offices="${esc(JSON.stringify(officeList(u)))}" data-services="${esc(JSON.stringify(serviceList(u)))}" value="${esc(u.id)}" ${chosen.includes(String(u.id))?'selected':''}>${esc(u.name)} — ${esc(summary(u))}</option>`);
    chosen.filter(id=>!candidates.some(u=>String(u.id)===id)).forEach(id=>options.push(`<option data-contact data-active="false" data-offices="[]" data-services="[]" value="${esc(id)}" selected>Correspondant indisponible (${esc(id)})</option>`));
    return options.join('');
  }
  function requestOffice(request,users=[]){
    if(request?.validationOffice)return request.validationOffice;
    if(request?.originOffice)return request.originOffice;
    const matches=(a,b)=>a!=null && b!=null && String(a)===String(b);
    const technician=users.find(u=>u.role==='Technicien' && (!request?.company_id || u.company_id===request.company_id) && (matches(u.uid,request?.technicienUid)||matches(u.id,request?.technicienId ?? request?.demandeurOriginalId)));
    if(office(technician))return office(technician);
    return office(users.find(u=>['Coordinateur','Coordinatrice','Superviseur Terrain'].includes(u.role) && (!request?.company_id || u.company_id===request.company_id) && matches(u.id,request?.coordinateurId)));
  }
  const coordinators=(user,users)=>users.filter(candidate=>['Coordinateur','Coordinatrice'].includes(candidate.role) && candidate.is_active!==false && (!candidate.account_status || candidate.account_status==='active') && candidate.company_id===user.company_id && officeList(user).some(o=>officeList(candidate).includes(o)) && serviceList(user).some(s=>serviceList(candidate).includes(s)) && (!user.allowedCoordinatorIds?.length || user.allowedCoordinatorIds.map(String).includes(String(candidate.id))));
  function fields(user={},users=typeof appData!=='undefined'?appData.users||[]:[]){
    const people=(roles,selected)=>contactOptions(users.filter(u=>!user.company_id||u.company_id===user.company_id),roles,selected);
    const selectedServices=serviceList(user),storekeeper=user.role==='Magasinier';
    if(storekeeper)return `<fieldset data-affiliation data-company="${esc(user.company_id||'')}" class="border rounded-xl p-3 space-y-3"><legend class="font-bold text-xs">Bureaux du magasinier</legend><label class="block text-xs">Bureaux attribues (au moins trois)<select name="office" multiple size="5" required class="w-full border rounded p-2">${Object.entries(offices).map(([key,label])=>`<option value="${key}" ${officeList(user).includes(key)?'selected':''}>${label}</option>`).join('')}</select></label><p class="text-xs text-slate-500">Le magasinier ne verra et ne pourra servir que les bons affectes dans les bureaux selectionnes.</p></fieldset>`;
    return `<fieldset data-affiliation data-company="${esc(user.company_id||'')}" onchange="AccountAffiliation.refreshServices(this.form);AccountAffiliation.filterContacts(this.form)" class="border rounded-xl p-3 space-y-3" ${concerned(user.role)?'':'hidden'}><legend class="font-bold text-xs">Rattachements du compte</legend><label data-mag-office class="block text-xs" hidden>Bureaux attribués au magasinier (au moins trois)<select name="storekeeperOffice" multiple size="5" required class="w-full border rounded p-2">${Object.entries(offices).map(([key,label])=>`<option value="${key}" ${officeList(user).includes(key)?'selected':''}>${label}</option>`).join('')}</select></label><p data-affiliation-general class="text-xs">Plusieurs choix possibles dans chaque liste (Ctrl/Cmd + clic sur ordinateur).</p><label data-affiliation-offices class="block text-xs">Bureaux<select name="office" multiple size="5" required class="w-full border rounded p-2">${Object.entries(offices).map(([key,label])=>`<option value="${key}" ${officeList(user).includes(key)?'selected':''}>${label}</option>`).join('')}</select></label><div data-affiliation-general><label class="block text-xs">Services<select name="accountService" multiple size="8" required class="w-full border rounded p-2">${Object.entries(services).map(([key,label])=>`<option data-office-group="other" value="${key}" ${selectedServices.includes(key)?'selected':''}>${label}</option>`).join('')}${Object.entries(bureau01Services).map(([key,label])=>`<option data-office-group="B01" value="${key}" ${selectedServices.includes(key)?'selected':''}>${label}</option>`).join('')}</select><span class="block text-slate-500 mt-1">Pour le bureau 01, choisissez parmi les services FTTH, Moov et MTN.</span></label><label class="block text-xs">Coordinateurs autorisés<select name="allowedCoordinatorIds" multiple size="4" class="w-full border rounded p-2">${people(['Coordinateur','Coordinatrice'],user.allowedCoordinatorIds)}</select></label><label class="block text-xs">Validateurs autorisés<select name="allowedValidatorIds" multiple size="4" class="w-full border rounded p-2">${people(['Validateur','Validatrice'],user.allowedValidatorIds)}</select></label><p class="text-xs text-slate-500">Sans sélection de personnes : circuit habituel selon les bureaux et services. Les coordinateurs choisis limitent les destinataires des demandes technicien ; les validateurs choisis limitent leur validation. Les accès aux stocks se règlent séparément.</p><p data-contact-status role="status" class="text-xs text-amber-800"></p><button type="button" class="border rounded p-2 text-xs" onclick="AccountAffiliation.loadContacts(this.form)">Actualiser les correspondants</button></div></fieldset>`;
  }
  function filterContacts(form){
    const group=form.querySelector('[data-affiliation]');if(!group)return;
    if(!group.querySelector('[name=allowedCoordinatorIds]'))return [];
    const company=form.querySelector('#cu-company-id')?.value||group.dataset.company;
    const officeCodes=selectedValues(group.querySelector('[name=office]')),serviceCodes=selectedValues(group.querySelector('[name=accountService]'));
    const errors=[],counts=[];
    for(const [name,needsService] of [['allowedCoordinatorIds',true],['allowedValidatorIds',false]]){
      const select=group.querySelector(`[name=${name}]`);let compatible=0;const invalid=[];
      for(const option of select.options){
        if(!option.hasAttribute('data-contact'))continue;
        let reason='';
        if(company&&option.dataset.company!==company)reason='autre entreprise';
        else if(option.dataset.active!=='true')reason='compte inactif ou indisponible';
        else if(!JSON.parse(option.dataset.offices).some(o=>officeCodes.includes(o)))reason='aucun bureau commun';
        else if(needsService&&!JSON.parse(option.dataset.services).some(s=>serviceCodes.includes(s)))reason='aucun service commun';
        option.dataset.incompatible=reason;option.hidden=Boolean(reason)&&!option.selected;option.disabled=Boolean(reason)&&!option.selected;
        if(!reason)compatible++;
        if(reason&&option.selected)invalid.push(option.textContent+' : '+reason);
      }
      select.setCustomValidity(invalid.join(' / '));errors.push(...invalid);counts.push(compatible);
    }
    const state=contactStates.get(group),status=group.querySelector('[data-contact-status]');
    if(status)status.textContent=state?.loading?'Chargement des correspondants...':state?.error|| (errors.length?'Choix incompatibles : '+errors.join(' ; ')+'. Modifiez les bureaux/services ou retirez ces choix.':`${counts[0]} coordinateur(s) et ${counts[1]} validateur(s) compatibles. Choisissez les bureaux et services avant les correspondants.`);
    return errors;
  }
  async function loadContacts(form){
    const group=form.querySelector('[data-affiliation]');if(!group)return;
    if(!group.querySelector('[name=allowedCoordinatorIds]'))return;
    const company=form.querySelector('#cu-company-id')?.value||group.dataset.company;
    if(!company){filterContacts(form);return;}
    const state={company,loading:true};contactStates.set(group,state);
    const lists=[['allowedCoordinatorIds',['Coordinateur','Coordinatrice']],['allowedValidatorIds',['Validateur','Validatrice']]];
    const selected=Object.fromEntries(lists.map(([name])=>[name,selectedValues(group.querySelector(`[name=${name}]`))]));
    lists.forEach(([name])=>group.querySelector(`[name=${name}]`).disabled=true);filterContacts(form);
    try{
      const {data,error}=await global.ITCSupabaseConfig.client.rpc('account_affiliation_contacts',{company});
      if(error)throw error;if(!Array.isArray(data))throw Error('Liste des correspondants indisponible.');
      if(!group.isConnected||contactStates.get(group)!==state)return;
      lists.forEach(([name,roles])=>{group.querySelector(`[name=${name}]`).innerHTML=contactOptions(data,roles,selected[name]);});
    }catch(error){if(contactStates.get(group)===state)state.error=error.code==='PGRST202'?'Mettez le serveur a jour avec la migration 202609270001 pour charger les correspondants.':error.message;}
    finally{if(group.isConnected&&contactStates.get(group)===state){state.loading=false;lists.forEach(([name])=>group.querySelector(`[name=${name}]`).disabled=group.hidden);filterContacts(form);}}
  }
  function update(form){
    const role=form.querySelector('#cu-user-role').value,group=form.querySelector('[data-affiliation]');group.hidden=!concerned(role);
    const storekeeper=role==='Magasinier';group.querySelectorAll('select').forEach(el=>{el.required=concerned(role)&&['office','accountService'].includes(el.name)&&!(storekeeper&&['office','accountService'].includes(el.name));el.disabled=!concerned(role)||(storekeeper&&el.name!=='storekeeperOffice');});
    group.querySelector('[data-mag-office]')?.toggleAttribute('hidden',!storekeeper);group.querySelector('[data-affiliation-offices]')?.toggleAttribute('hidden',storekeeper);group.querySelectorAll('[data-affiliation-general]').forEach(el=>el.toggleAttribute('hidden',storekeeper));const storeOffice=group.querySelector('[name=storekeeperOffice]');if(storeOffice){storeOffice.required=storekeeper;storeOffice.disabled=!storekeeper;}
    refreshServices(form);
    const company=form.querySelector('#cu-company-id')?.value||group.dataset.company;
    if(company&&contactStates.get(group)?.company!==company)loadContacts(form);else filterContacts(form);
  }
  function refreshServices(form){
    const group=form?.querySelector('[data-affiliation]');if(!group)return;
    const offices=selectedValues(group.querySelector('[name=office]'));
    const showB01=offices.includes('B01'),showOther=offices.some(code=>code!=='B01');
    for(const option of group.querySelector('[name=accountService]')?.options||[]){
      const allowed=option.dataset.officeGroup==='B01'?showB01:showOther;
      option.hidden=!allowed;option.disabled=!allowed;
      if(!allowed)option.selected=false;
    }
  }
  function values(form,role){
    if(!concerned(role))return {};
    const group=form.querySelector('[data-affiliation]'),state=contactStates.get(group);
    if(role==='Magasinier'){const selected=group.querySelector('[name=storekeeperOffice]')?selectedValues(group.querySelector('[name=storekeeperOffice]')):selectedValues(group.querySelector('[name=office]'));if(selected.length<3||selected.length>5||selected.some(code=>!global.AccountAffiliation.offices[code]))throw Error('Attribuez au moins trois bureaux au magasinier.');return {office:selected[0],offices:selected,services:[],serviceAbbreviation:'',allowedCoordinatorIds:[],allowedValidatorIds:[]};}
    if(state?.loading)throw Error('Patientez pendant le chargement des correspondants.');if(state?.error)throw Error(state.error);
    const selected=name=>selectedValues(form.querySelector(`[name=${name}]`)),officeCodes=selected('office'),serviceCodes=selected('accountService');
    const hasB01=officeCodes.includes('B01'),hasOther=officeCodes.some(o=>o!=='B01');
    if(!officeCodes.length||!serviceCodes.length||officeCodes.some(o=>!offices[o])||serviceCodes.length>3||serviceCodes.some(s=>!(services[s]&&hasOther)&&!(bureau01Services[s]&&hasB01)))throw Error('Choisissez un à trois services compatibles avec les bureaux du compte.');
    const errors=filterContacts(form);if(errors?.length)throw Error(errors.join(' ; '));
    return {office:officeCodes[0],serviceAbbreviation:serviceCodes[0],offices:officeCodes,services:serviceCodes,allowedCoordinatorIds:selected('allowedCoordinatorIds'),allowedValidatorIds:selected('allowedValidatorIds')};
  }
  function requestFields(user,prefix){const choices=officeList(user);return `<label class="block text-xs">Bureau émetteur<select id="${prefix}-office" required class="w-full border p-3 rounded-xl" ${prefix==='t'?'onchange="AccountAffiliation.refreshCoordinators()"':''}>${choices.length?choices.map(o=>`<option value="${esc(o)}">${esc(offices[o]||o)}</option>`).join(''):'<option value="" selected disabled>Aucun bureau affecté au compte</option>'}</select>${choices.length?'':'<span class="block text-amber-700 mt-1">Faites renseigner les bureaux du superviseur par le responsable de l’application.</span>'}</label>`;}
  function serviceField(user,id){const isCoordination=['Coordinateur','Coordinatrice'].includes(user?.role),choices=isCoordination&&isBureau01(user)?bureau01Services:Object.fromEntries(serviceList(user).map(s=>[s,services[s]||s]));return `<label class="block text-xs">Service émetteur<select id="${id}" required class="w-full border p-3 rounded-xl" ${id==='t-service'?'onchange="AccountAffiliation.refreshCoordinators();renderTechMaterialPicker()"':''}>${Object.entries(choices).map(([s,label])=>`<option value="${esc(s)}" ${s===user?.serviceAbbreviation?'selected':''}>${esc(label)}</option>`).join('')||'<option value="" selected disabled>Aucun service affecté au compte</option>'}</select>${Object.keys(choices).length?'':'<span class="block text-amber-700 mt-1">Faites renseigner les services du superviseur par le responsable de l’application.</span>'}</label>`;}
  function requestUser(user,prefix){const chosenOffice=document.getElementById(prefix+'-office')?.value||office(user),chosenService=document.getElementById(prefix+'-service')?.value||user.serviceAbbreviation;return {...user,office:chosenOffice,offices:[chosenOffice],serviceAbbreviation:chosenService,services:[chosenService]};}
  function refreshCoordinators(){const select=document.getElementById('t-coordinateur');if(!select)return;const old=select.value;select.innerHTML='<option value="">Choisir le coordinateur</option>'+coordinators(requestUser(currentUser,'t'),appData.users||[]).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');if(Array.from(select.options).some(o=>o.value===old))select.value=old;}
  async function edit(id){
    if(!isCurrentCompanySupervisor())return;
    const user=appData.users.find(u=>String(u.id)===String(id));if(!user||!concerned(user.role))return;
    const modal=document.createElement('dialog');modal.className='rounded-2xl p-6 max-w-lg';
    modal.innerHTML=`<form class="space-y-4"><h3 class="font-bold">${user.role==='Magasinier'?'Bureaux du magasinier':'Bureau et service'}</h3>${fields(user)}<p role="status"></p><button type="submit" class="bg-indigo-700 text-white p-3 rounded-xl">Enregistrer</button><button type="button" data-affiliation-cancel class="p-3">Annuler</button></form>`;
    document.body.append(modal);modal.onclose=()=>modal.remove();modal.querySelector('[data-affiliation-cancel]').onclick=()=>modal.close();
    modal.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=modal.querySelector('[type=submit]');button.disabled=true;try{const a=values(event.target,user.role);const byRecord=Boolean(user._dbKey);const {error}=await global.ITCSupabaseConfig.client.rpc(byRecord?'assign_account_affiliations_by_record':'assign_account_affiliations',{...(byRecord?{target_key:user._dbKey}:{target_uid:user.uid}),office_codes:a.offices,service_codes:a.services,coordinator_ids:a.allowedCoordinatorIds,validator_ids:a.allowedValidatorIds});if(error){if(error.code==='PGRST202')throw Error('Le serveur doit être mis à jour pour enregistrer les rattachements des comptes migrés (migration 202609260005).');throw error;}await refreshAppDataFromServer();modal.close();renderCompanyUsersAdmin(document.getElementById('app-container'));}catch(error){modal.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}};
    modal.showModal();
    refreshServices(modal.querySelector('form'));
    await loadContacts(modal.querySelector('form'));
  }
  function ownSection(user){
    if(!concerned(user.role))return '';
    const initialServices=isBureau01(user)&&['Coordinateur','Coordinatrice'].includes(user.role)?bureau01Services:services;
    const selection=['Coordinateur','Coordinatrice'].includes(user.role) && user.canChooseInitialService===true && !user.serviceAbbreviation;
    return `<section class="bg-white rounded-2xl p-6 border space-y-4"><h3 class="font-bold">${user.role==='Magasinier'?'Bureaux attribués':'Bureaux et services'}</h3><p>${esc(summary(user))}</p>${selection?`<form onsubmit="AccountAffiliation.chooseService(event)" class="space-y-3"><label class="block">Choisissez votre service<select name="accountService" required class="border p-3 rounded-xl"><option value="">Choisir</option>${Object.entries(initialServices).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><p class="text-sm">Les techniciens de votre bureau et de ce service pourront vous adresser leurs demandes. Après enregistrement, le responsable pourra corriger votre rattachement.</p><button type="submit" class="bg-indigo-700 text-white p-3 rounded-xl">Enregistrer mon service</button><p role="status"></p></form>`:''}</section>`;
  }
  async function chooseService(event){
    event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
    try{const service_code=form.querySelector('[name=accountService]').value;const allowed=isBureau01(currentUser)?bureau01Services:services;if(!allowed[service_code])throw Error('Choisissez votre service.');const {error}=await global.ITCSupabaseConfig.client.rpc('choose_initial_coordinator_service',{service_code});if(error)throw error;await refreshAppDataFromServer();renderMonProfil(document.getElementById('app-container'));}catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}
  }
  global.AccountAffiliation={offices,services,bureau01Services,concerned,office,officeList,serviceList,summary,filterContacts,loadContacts,requestOffice,coordinators,fields,update,refreshServices,values,edit,ownSection,chooseService,requestFields,serviceField,requestUser,refreshCoordinators};
})(window);
