const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n      }',start)+8);}
(async()=>{
 const badge={innerText:0,hidden:true,classList:{toggle(name,value){badge.hidden=value;}}};
 const context={window:{},console,navigator:{},currentUser:{id:7,company_id:'A',role:'Gestionnaire'},document:{querySelectorAll:()=>[],getElementById:id=>id==='notif-gest-coord'?badge:null}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('assets/notification-tabs.js','utf8'),context);
 vm.runInContext(fs.readFileSync('assets/supabase-store.js','utf8'),context);
 const rows=[
  {record_key:'legacy',company_id:'A',payload:{userId:7,lu:false,message:'Ancienne commande'}},
  {record_key:'new',company_id:'A',payload:{userId:'7',company_id:'A',lu:false,message:'Commande'}},
  {record_key:'read',company_id:'A',payload:{userId:7,company_id:'A',lu:true}},
  {record_key:'other',company_id:'A',payload:{userId:8,company_id:'A',lu:false}},
 ];
 let writes=0,fail=false;
 const client={from:()=>({select:()=>({eq:async()=>({data:[],error:null})})}),rpc:async(name,{record_keys})=>{
  assert.equal(name,'mark_app_notifications_read');if(fail)return {error:Error('Offline')};
  for(const key of record_keys){
   const row=rows.find(r=>r.record_key===key);
   assert.equal(row.company_id,'A'); assert.equal(String(row.payload.userId),'7');
   row.payload.lu=true;writes++;
  }
  return {data:record_keys,error:null};
 }};
 const store=new context.window.SupabaseStore(client,data=>{context.appData=data;},()=>{});
 store.ready=true;store.uid='manager';store.profile=context.currentUser;
 store.readAllRecords=async()=>rows.map(r=>({collection:'notifications',...r}));context.secureStore=store;
 vm.runInContext('let pendingSave=null;let markingNotifications=false;let lastNotificationCount=0;'+extract('markNotificationsAsRead')+'\n'+extract('updateNotifications'),context);
 await store.read(store.generation);context.updateNotifications();assert.equal(badge.innerText,2);assert.equal(badge.hidden,false);
 await context.markNotificationsAsRead();assert.equal(badge.innerText,0);assert.equal(badge.hidden,true);assert.equal(writes,2);
 assert.equal(rows.find(r=>r.record_key==='other').payload.lu,false);
 await store.read(store.generation);context.updateNotifications();assert.equal(badge.innerText,0,'read state survives reload');
 await context.markNotificationsAsRead();assert.equal(writes,2,'reopening does not write again');
 rows.push({record_key:'latest',company_id:'A',payload:{userId:7,company_id:'A',lu:false}});
 await store.read(store.generation);context.updateNotifications();assert.equal(badge.innerText,1);assert.equal(badge.hidden,false);
 fail=true;await context.markNotificationsAsRead();assert.equal(badge.innerText,1,'failed persistence leaves notification unread');
 fail=false;await context.markNotificationsAsRead();assert.equal(badge.innerText,0);assert.equal(badge.hidden,true);
 assert.match(html,/\.notification-badge\.hidden\s*\{\s*display:\s*none;/,'hidden style overrides badge display:flex');
 console.log('PASS: Commands unread count, legacy payload persistence, string IDs, zero hides badge, new notification reappears, reload and failure preservation.');
})().catch(error=>{console.error(error);process.exitCode=1});
