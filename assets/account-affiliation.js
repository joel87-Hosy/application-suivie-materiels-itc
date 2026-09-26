(function(global){
  'use strict';
  const offices={B01:'Bureau 01',B02:'Bureau 02',BOUAKE:'Bouaké','SAN-PEDRO':'San-Pédro',YAMOUSSOUKRO:'Yamoussoukro'};
  const services={B2B:'B2B',DEP:'Déploiement',MAIN:'Maintenance'};
  const concerned=role=>['Technicien','Coordinateur','Coordinatrice','Gestionnaire','Validateur','Validatrice'].includes(role);
  const office=user=>user?.office || user?.validationBureau || '';
  function requestOffice(request,users=[]){
    if(request?.originOffice)return request.originOffice;
    const matches=(a,b)=>a!=null && b!=null && String(a)===String(b);
    const technician=users.find(u=>u.role==='Technicien' && (!request?.company_id || u.company_id===request.company_id) && (matches(u.uid,request?.technicienUid)||matches(u.id,request?.technicienId ?? request?.demandeurOriginalId)));
    if(office(technician))return office(technician);
    return office(users.find(u=>['Coordinateur','Coordinatrice','Superviseur Terrain'].includes(u.role) && (!request?.company_id || u.company_id===request.company_id) && matches(u.id,request?.coordinateurId)));
  }
  const coordinators=(user,users)=>users.filter(candidate=>['Coordinateur','Coordinatrice'].includes(candidate.role) && candidate.is_active!==false && (!candidate.account_status || candidate.account_status==='active') && candidate.company_id===user.company_id && office(user) && office(candidate)===office(user) && services[user.serviceAbbreviation] && candidate.serviceAbbreviation===user.serviceAbbreviation);
  const fields=(user={})=>`<fieldset data-affiliation class="border rounded-xl p-3 space-y-3" ${concerned(user.role)?'':'hidden'}><legend class="font-bold text-xs">Rattachement du compte</legend><label class="block text-xs">Bureau<select name="office" class="w-full border rounded p-2"><option value="">Choisir le bureau</option>${Object.entries(offices).map(([key,label])=>`<option value="${key}" ${office(user)===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="block text-xs">Service<select name="accountService" class="w-full border rounded p-2"><option value="">Choisir le service</option>${Object.entries(services).map(([key,label])=>`<option value="${key}" ${user.serviceAbbreviation===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="text-xs text-slate-500">Les validateurs traitent tous les services de leur bureau.</p></fieldset>`;
  function update(form){const role=form.querySelector('#cu-user-role').value,group=form.querySelector('[data-affiliation]');group.hidden=!concerned(role);group.querySelectorAll('select').forEach(el=>{el.required=concerned(role);el.disabled=!concerned(role);});}
  function values(form,role){if(!concerned(role))return {};const office=form.querySelector('[name=office]').value,serviceAbbreviation=form.querySelector('[name=accountService]').value;if(!offices[office]||!services[serviceAbbreviation])throw Error('Choisissez le bureau et le service du compte.');return {office,serviceAbbreviation};}
  async function edit(id){
    if(!isCurrentCompanySupervisor())return;
    const user=appData.users.find(u=>String(u.id)===String(id));if(!user||!concerned(user.role))return;
    const modal=document.createElement('dialog');modal.className='rounded-2xl p-6 max-w-lg';
    modal.innerHTML=`<form class="space-y-4"><h3 class="font-bold">Bureau et service</h3>${fields(user)}<p role="status"></p><button type="submit" class="bg-indigo-700 text-white p-3 rounded-xl">Enregistrer</button><button type="button" class="p-3">Annuler</button></form>`;
    modal.querySelectorAll('select').forEach(el=>el.required=true);document.body.append(modal);modal.onclose=()=>modal.remove();modal.querySelector('[type=button]').onclick=()=>modal.close();
    modal.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=modal.querySelector('[type=submit]');button.disabled=true;try{const affiliation=values(event.target,user.role);const {error}=await global.ITCSupabaseConfig.client.rpc('assign_account_affiliation',{target_uid:user.uid,office_code:affiliation.office,service_code:affiliation.serviceAbbreviation});if(error)throw error;await refreshAppDataFromServer();modal.close();renderCompanyUsersAdmin(document.getElementById('app-container'));}catch(error){modal.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}};
    modal.showModal();
  }
  function ownSection(user){
    if(!concerned(user.role))return '';
    const selection=['Coordinateur','Coordinatrice'].includes(user.role) && user.canChooseInitialService===true && !user.serviceAbbreviation;
    return `<section class="bg-white rounded-2xl p-6 border space-y-4"><h3 class="font-bold">Bureau et service</h3><p>${offices[office(user)] || 'Bureau à renseigner par le responsable'} · ${services[user.serviceAbbreviation] || 'Service à renseigner'}</p>${selection?`<form onsubmit="AccountAffiliation.chooseService(event)" class="space-y-3"><label class="block">Choisissez votre service<select name="accountService" required class="border p-3 rounded-xl"><option value="">Choisir</option>${Object.entries(services).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><p class="text-sm">Les techniciens de votre bureau et de ce service pourront vous adresser leurs demandes. Après enregistrement, le responsable pourra corriger votre rattachement.</p><button type="submit" class="bg-indigo-700 text-white p-3 rounded-xl">Enregistrer mon service</button><p role="status"></p></form>`:''}</section>`;
  }
  async function chooseService(event){
    event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
    try{const service_code=form.querySelector('[name=accountService]').value;if(!services[service_code])throw Error('Choisissez votre service.');const {error}=await global.ITCSupabaseConfig.client.rpc('choose_initial_coordinator_service',{service_code});if(error)throw error;await refreshAppDataFromServer();renderMonProfil(document.getElementById('app-container'));}catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}
  }
  global.AccountAffiliation={offices,services,concerned,office,requestOffice,coordinators,fields,update,values,edit,ownSection,chooseService};
})(window);
