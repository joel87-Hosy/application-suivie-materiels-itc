const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('index.html','utf8');
function extract(name){const start=source.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n      }',start)+8);}
const auth=source.slice(source.indexOf('      let authStateGeneration = 0;'),source.indexOf('      if (useSupabaseBackend) {',source.indexOf('      let authStateGeneration = 0;')));
(async()=>{
 const elements=Object.fromEntries(['app-container','main-app','login-screen'].map(id=>[id,{innerHTML:'old dashboard',textContent:'',classList:{add(){},remove(){}}}]));
 let profile,authUser,fail=false,logouts=0;const renders=[];
 const context={console:{warn(){},error(){}},window:{ValidatorWorkflow:{isValidator:()=>false}},ControlCore:require('../assets/control-core'),
  currentUser:null,currentSectionId:'cockpit',appData:{},useSupabaseBackend:true,logoutRequested:false,
  document:{getElementById:id=>elements[id]},normalizeAppData:data=>data,refreshDesignationsDatalists(){},updateMenuVisibility(){},updateUserInfo(){},updateNotifications(){},clearPrivateLocalData(){},emptyAppData:()=>({}),logout:()=>{logouts++;},
  getActiveAuthUser:async()=>authUser,escapeHtml:value=>String(value),getOperatorMeta:op=>({label:op,icon:'',border:'',badge:''}),
  renderCockpitCharts:(totals,alerts)=>renders.push({role:context.currentUser.role,ops:Array.from(totals,t=>t.op)}),
  secureStore:{connect:async()=>{if(fail)throw Error('Refused');context.secureStore.profile=profile;},value:()=>({users:[profile],stock:['ITC-B01','OCI','CIC','MTN','ITC-B02','MOOV'].map(op=>({op,label:'ARTICLE '+op,qty:5})),demandes:[]}),stop(){}},
 };
 vm.createContext(context);vm.runInContext(['refreshAppDataFromServer','getDefaultSectionForUser','renderCockpit','getManagedOpsNormalized','isStockScopedUser','isGestionnaireUser','isTechnicienUser','isOperatorAllowedForUser','normalizeOperatorKey'].map(extract).join('\n')+'\n'+auth+'\nthis.restoreSession=handleActiveAuthState;',context);
 context.showSection=id=>{context.currentSectionId=id;if(id==='cockpit')context.renderCockpit(elements['app-container']);else renders.push({role:context.currentUser.role,section:id});};
 // Initial reload must not render unfiltered stock before the user is restored.
 profile={id:2,email:'b02@test',role:'Gestionnaire',controlScopes:{'ITC-B02':true,MOOV:true}};authUser={id:'b02',email:profile.email};
 await context.refreshAppDataFromServer();assert.equal(renders.length,0);
 context.renderCockpit(elements['app-container']);assert.equal(renders.length,0);assert.match(elements['app-container'].textContent,/Chargement/);
 context.currentUser={role:'Superviseur'};
 await context.restoreSession(authUser);assert.equal(renders.length,1);assert.deepEqual(renders[0],{role:'Gestionnaire',ops:['ITC-B02','MOOV']});
 assert.ok(!elements['app-container'].innerHTML.includes('ARTICLE ITC-B01'));
 for(const [role,section] of [['Superviseur','cockpit'],['Validateur','cockpit'],['SUPER_ADMIN','super-admin'],['Technicien','tech-nouvelle-demande'],['Contrôleur','control-dashboard']]){
  renders.length=0;profile={id:3,email:'next@test',role,controlScopes:{}};authUser={id:'next',email:profile.email};
  await context.restoreSession(authUser);assert.equal(context.currentSectionId,section);assert.equal(renders.length,1);assert.equal(renders[0].role,role);
 }
 renders.length=0;fail=true;await context.restoreSession(authUser);assert.equal(renders.length,0);assert.equal(context.currentUser,null);assert.equal(logouts,1);
 await assert.rejects(context.refreshAppDataFromServer(),/Refused/,'failed authentication must propagate');
 // Late restoration cannot revive a signed-out account.
 fail=false;let release;context.secureStore.connect=()=>new Promise(resolve=>{release=resolve;});
 const restoring=context.restoreSession(authUser);await Promise.resolve();await Promise.resolve();
 await context.restoreSession(null);release();await restoring;assert.equal(context.currentUser,null);assert.equal(renders.length,0);
 console.log('PASS: reload waits for verified role, B02 initial dashboard scoped, default page per account, stale view replaced, failed and cancelled sessions never render a dashboard.');
})().catch(error=>{console.error(error);process.exitCode=1});
