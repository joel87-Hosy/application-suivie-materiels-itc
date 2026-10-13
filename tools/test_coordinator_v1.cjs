const fs=require('fs');
const vm=require('vm');
const assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');

(async()=>{
  const affiliationWindow={};
  vm.runInNewContext(fs.readFileSync('assets/account-affiliation.js','utf8'),{window:affiliationWindow,Object});
  const affiliation=affiliationWindow.AccountAffiliation;
  const v1={role:'Coordinateur V1',company_id:'A'};
  assert.equal(affiliation.concerned(v1.role),true);
  assert.deepEqual(Array.from(affiliation.officeList(v1)),['B01','B02']);
  assert.equal(affiliation.serviceList(v1).length,11);
  const html=affiliation.fields(v1,[]);
  assert.match(html,/data-coordinator-v1="true"/);
  assert.match(html,/Le Coordinateur V1 couvre les bureaux 01 et 02/);
  assert.equal((html.match(/data-office-group="B01"/g)||[]).length,8);
  assert.equal((html.match(/data-office-group="other"/g)||[]).length,3);

  let affiliationHtml='<fieldset data-coordinator-v1="false"></fieldset>',affiliationUpdates=0;
  const roleSelect={value:'Coordinateur V1'},companySelect={value:'A'};
  const affiliationGroup={get dataset(){return {coordinatorV1:affiliationHtml.includes('data-coordinator-v1="true"')?'true':'false'};},set outerHTML(value){affiliationHtml=value;}};
  const form={querySelector:selector=>selector==='#cu-user-role'?roleSelect:selector==='#cu-company-id'?companySelect:selector==='[data-affiliation]'?affiliationGroup:null};
  const companyUsersWindow={AccountAffiliation:{...affiliation,update:()=>affiliationUpdates++}};
  vm.runInNewContext(fs.readFileSync('assets/company-users.js','utf8'),{window:companyUsersWindow,appData:{users:[]}});
  companyUsersWindow.CompanyUsers.updateCreateForm(form);
  assert.match(affiliationHtml,/data-coordinator-v1="true"/,'selecting V1 rebuilds the affiliation fields for its cross-office role');
  assert.match(affiliationHtml,/value="B01" selected/);
  assert.match(affiliationHtml,/value="B02" selected/);
  assert.equal(affiliationUpdates,1);
  roleSelect.value='Contrôleur';
  companyUsersWindow.CompanyUsers.updateCreateForm(form);
  assert.match(affiliationHtml,/data-coordinator-v1="false"/,'leaving V1 restores the standard affiliation fields');
  assert.equal(affiliationUpdates,2);

  const migration=fs.readFileSync('supabase/migrations/202610130001_coordinator_v1_dual_office.sql','utf8');
  for(const required of ['Coordinateur V1','workflow_request_choices','guard_request_validation_office','change_company_user_role','CHANGE_COMPANY_USER_ROLE','ITC-B01','ITC-B02'])assert.ok(migration.includes(required),`migration includes ${required}`);

  const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/company-users/index.ts','utf8').replace(/^import[^\n]+\n/,''),{mode:'strip'});
  let handler,actor={role:'Superviseur',company_id:'A',is_active:true},created=0,rpcs=[];
  const stockRows=['ITC-B01','OCI','CIC','MTN','ITC-B02','MOOV'].map(op=>({op}));
  const admin={
    from(table){
      const query={select(){return this;},eq(){return this;},single:async()=>({data:actor,error:null}),then(resolve){return Promise.resolve({data:table==='stock_locations'?stockRows:[],error:null}).then(resolve);}};
      return query;
    },
    auth:{admin:{createUser:async()=>{created++;return {data:{user:{id:'target-id'}},error:null};},deleteUser:async()=>({error:null})}},
    rpc:async(name,args)=>{rpcs.push({name,args});return {data:name==='change_company_user_role'?true:null,error:null};}
  };
  const session={auth:{getUser:async()=>({data:{user:{id:'actor-id'}},error:null})}};
  vm.runInNewContext(source,{Deno:{serve:fn=>handler=fn,env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service':'public'}},createClient:(url,key)=>key==='service'?admin:session,Response,Request,Set});
  const call=async body=>handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));
  const request={companyId:'A',role:'Coordinateur V1',managedOps:[],email:'coord@example.test',name:'Coordinateur V1',password:'temporary-password',offices:['B01','B02'],services:['PROD','B2B','DEP'],allowedCoordinatorIds:[],allowedValidatorIds:[]};
  assert.equal((await call({...request,offices:['B01']})).status,400);
  assert.equal(created,0,'invalid bureau assignment is rejected before creating Auth users');
  assert.equal((await call(request)).status,200);
  assert.equal(created,1);
  const registration=rpcs.at(-1);
  assert.equal(registration.name,'register_company_user_multi');
  assert.deepEqual(Array.from(registration.args.stock_ops),['ITC-B01','OCI','CIC','MTN','ITC-B02','MOOV']);
  assert.deepEqual(Array.from(registration.args.office_codes),['B01','B02']);
  assert.deepEqual(Array.from(registration.args.service_codes),['PROD','B2B','DEP']);

  actor.role='DG';
  assert.equal((await call({action:'change-role',companyId:'A',targetUid:'target-id',role:'Coordinateur V1',managedOps:[],offices:['B01','B02'],services:['PROD','B2B'],allowedCoordinatorIds:[],allowedValidatorIds:[]})).status,200);
  const change=rpcs.at(-1);
  assert.equal(change.name,'change_company_user_role');
  assert.equal(change.args.new_role,'Coordinateur V1');
  assert.deepEqual(Array.from(change.args.stock_ops),['ITC-B01','OCI','CIC','MTN','ITC-B02','MOOV']);
  assert.equal((await call({action:'change-role',companyId:'B',targetUid:'target-id',role:'Technicien',managedOps:[]})).status,403);
  console.log('PASS: Coordinateur V1 affiliations, account creation, dual-office stock scope, and supervisor/DG role changes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
