const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
 let result={error:'Rôle non autorisé.'},ok=false,refreshes=0,lastRequest;
 const alerts=[];
 const context={window:{crypto:{randomUUID:()=> 'operation'},ITCSupabaseConfig:{projectUrl:'https://test',publishableKey:'public',client:{auth:{getSession:async()=>({data:{session:{access_token:'session'}}})}}}},
  isCurrentCompanySupervisor:()=>true,currentUser:{id:1},appData:{users:[{id:2,uid:'target',company_id:'A',name:'User'}]},
  document:{querySelectorAll:()=>[]},confirm:()=>true,alert:message=>alerts.push(message),
  fetch:async(url,options)=>{lastRequest=JSON.parse(options.body);return {ok,json:async()=>result};},
  refreshAppDataFromServer:async()=>refreshes++,currentSectionId:'cockpit'};
 vm.runInNewContext(fs.readFileSync('assets/company-users.js','utf8'),context);
 const manage=context.window.CompanyUsers.manage;
 await manage(2,'delete');assert.match(alerts.pop(),/ancienne version/);assert.equal(refreshes,0);assert.equal(lastRequest.action,'delete');assert.equal(lastRequest.role,undefined);
 ok=true;result={created:true};await manage(2,'delete');assert.match(alerts.pop(),/pas confirmé/);assert.equal(refreshes,0);
 result={updated:true,action:'suspend'};await manage(2,'delete');assert.equal(refreshes,0);
 result={updated:true,action:'delete'};await manage(2,'delete');assert.equal(refreshes,1);assert.match(alerts.pop(),/mis à jour/);
 console.log('PASS: old server error distinguished from supervisor permissions; deletion requires matching server confirmation.');
})().catch(error=>{console.error(error);process.exitCode=1});
