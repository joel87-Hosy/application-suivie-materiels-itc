const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/company-users/index.ts','utf8').replace(/^import[^\n]+\n/,''),{mode:'strip'});
 let handler,actor={role:'DG',company_id:'A',is_active:true},authError=null,prepareError=null,complete=false;const calls=[];
 const operation={id:'00000000-0000-0000-0000-000000000010',target_id:'supabase-target',status:'pending'};
 const admin={from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:actor})}),rpc:async(name,args)=>{calls.push({name,args});return name.startsWith('prepare')?{data:{...operation,status:complete?'complete':'pending'},error:prepareError}:{error:null};},auth:{admin:{updateUserById:async(id,attributes)=>{calls.push({name:'updateAuth',id,attributes});return {error:authError};},deleteUser:async id=>{calls.push({name:'deleteAuth',id});return {error:authError};}}}};
 const session={auth:{getUser:async()=>({data:{user:{id:'director'}}})}};
 vm.runInNewContext(source,{Deno:{serve:fn=>handler=fn,env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'secret':'public'}},createClient:(url,key)=>key==='secret'?admin:session,Response,Request,Set});
 const call=async(action,extra={})=>{calls.length=0;return handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer user','Content-Type':'application/json'},body:JSON.stringify({companyId:'A',targetUid:'firebase-target',operationId:operation.id,action,...extra})}));};
 for(const action of ['suspend','disable','activate']){
  assert.equal((await call(action)).status,200);assert.deepEqual(calls.map(c=>c.name),['prepare_company_account_action','updateAuth','finish_company_account_action']);
  assert.equal(calls[1].id,'supabase-target');assert.equal(calls[1].attributes.ban_duration,action==='activate'?'none':'876000h');
 }
 assert.equal((await call('delete')).status,200);assert.equal(calls[1].name,'deleteAuth');
 actor.role='Superviseur';
 for(const action of ['delete','suspend','disable','activate']){
  const response=await call(action);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.updated,true);assert.equal(body.action,action);
  assert.equal(calls[0].name,'prepare_company_account_action');
 }
 for(const action of ['',null,false]){
  assert.equal((await call(action)).status,400);assert.equal(calls.length,0,'invalid action must not enter account creation');
 }
 actor.role='DG';
 prepareError={message:'Compte protégé'};assert.equal((await call('delete')).status,400);assert.equal(calls.length,1);prepareError=null;
 authError={message:'Unavailable'};assert.equal((await call('delete')).status,503);assert.equal(calls.length,2,'never finalize a failed Auth mutation');
 authError={code:'user_not_found'};assert.equal((await call('delete')).status,200);assert.equal(calls.length,3,'resume a successful deletion whose response was lost');authError=null;
 complete=true;assert.equal((await call('delete')).status,200);assert.equal(calls.length,1,'completed retries never repeat Auth calls');complete=false;
 actor.role='Technicien';assert.equal((await call('delete')).status,403);assert.equal(calls.length,0);actor.role='DG';
 assert.equal((await call('delete',{companyId:'B'})).status,403);assert.equal(calls.length,0);
 assert.equal((await call('other')).status,400);
 console.log('PASS: DG Auth ban/unban/delete, verified actor, Supabase UUID resolution, no mutation on rejection, partial failure and completed retries.');
})().catch(error=>{console.error(error);process.exitCode=1});
