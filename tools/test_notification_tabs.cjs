const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
 const context={window:{},console};vm.createContext(context);
 vm.runInContext(fs.readFileSync('assets/notification-tabs.js','utf8'),context);
 const tabs=context.window.NotificationTabs;
 const user={id:7,company_id:'A',role:'Gestionnaire'};
 const rows=['COMMANDE : BON-1','RETOUR : technicien','TRANSFERT TR-1','ENTRÉE STOCK : Câble'].map((message,i)=>({_dbKey:String(i),userId:'7',company_id:'A',lu:false,message}));
 for(const [index,section] of ['demandes-coordonnatrice','gestion-retours','transferts-stocks','reception'].entries())assert.deepEqual(Array.from(tabs.unread(rows,user,section),n=>n._dbKey),[String(index)]);
 for(const [role,message,section] of [['Validateur','BON À VALIDER','validation-bons'],['Validatrice','BON','validation-bons'],['Technicien','VOTRE MATERIEL EST DISPONIBLE','tech-mes-demandes'],['Coordinatrice','BESOIN : équipe','coord-demandes-tech'],['Coordinateur','Votre commande est envoyée','bons-signes'],['Superviseur','TRANSFERT TR-1','trafic-audit']])assert.equal(tabs.section({message},{role}),section);
 assert.equal(tabs.unread([...rows,{...rows[0],userId:8},{...rows[0],company_id:'B'},{...rows[0],lu:true}],user).length,4);
 // Selective persistence: opening one tab does not clear other tabs or new arrivals.
 vm.runInContext(fs.readFileSync('assets/supabase-store.js','utf8'),context);
 let changes;
 const store=new context.window.SupabaseStore({rpc:async(name,args)=>{changes=args.record_keys;store.raw.notifications.arrival={userId:7,company_id:'A',lu:false,message:'COMMANDE nouvelle'};return {data:args.record_keys,error:null};}},()=>{},()=>{});
 store.ready=true;store.profile=user;store.raw.notifications=Object.fromEntries(rows.map(({_dbKey,...payload})=>[_dbKey,payload]));
 await store.markNotificationsRead(['0']);assert.equal(changes.length,1);assert.equal(store.raw.notifications['0'].lu,true);
 for(const key of ['1','2','3','arrival'])assert.equal(store.raw.notifications[key].lu,false);
 changes=null;await store.markNotificationsRead([]);assert.equal(changes,null,'empty selection never marks everything');
 // Menu badges are created once and hidden independently when read.
 const buttons=['demandes-coordonnatrice','gestion-retours','transferts-stocks','validation-bons'].map(section=>({dataset:{notificationSection:section},getAttribute:()=>'',querySelector(){return this.badge;},append(badge){this.badge=badge;}}));
 const document={querySelectorAll:selector=>selector.startsWith('aside')?buttons:buttons.map(b=>b.badge).filter(Boolean),getElementById:()=>null,createElement:()=>({dataset:{},setAttribute(){},classList:{toggle(name,hidden){this.hidden=hidden;}}})};
 tabs.update(document,rows,user);assert.equal(buttons[0].badge.innerText,1);assert.equal(buttons[3].badge.classList.hidden,true);
 const first=buttons[0].badge;rows[0].lu=true;tabs.update(document,rows,user);assert.equal(buttons[0].badge,first);assert.equal(first.classList.hidden,true);assert.equal(buttons[1].badge.classList.hidden,false);
 rows.push({...rows[0],_dbKey:'latest',lu:false});tabs.update(document,rows,user);assert.equal(first.innerText,1);assert.equal(first.classList.hidden,false);
 // Control notifications persist the latest displayed event, never the current clock.
 const controlSource=fs.readFileSync('assets/stock-control.js','utf8');
 const extract=name=>{const start=controlSource.indexOf('  function '+name+'(');return controlSource.slice(start,controlSource.indexOf('\n  }',start)+4);};
 const state={preferences:{u:{lastSeen:'2026-09-23T10:00:00Z'}}};
 const events=[{at:'2026-09-23T10:01:00Z'},{at:'2026-09-23T10:02:00Z'}];
 let writes=0;
 const controlContext={state,uid:'u',rows:()=>events,run:work=>work(),ref:path=>({update:async value=>{assert.equal(path,'preferences/u');writes++;events.push({at:'2026-09-23T10:03:00Z'});state.preferences.u=value;}})};
 vm.createContext(controlContext);vm.runInContext(extract('controlUnreadCount')+'\n'+extract('markControlNotificationsRead'),controlContext);
 assert.equal(controlContext.controlUnreadCount(),2);await controlContext.markControlNotificationsRead();
 assert.equal(state.preferences.u.lastSeen,'2026-09-23T10:02:00Z');assert.equal(controlContext.controlUnreadCount(),1);assert.equal(writes,1);
 state.preferences.u.lastSeen='2026-09-23T10:03:00Z';await controlContext.markControlNotificationsRead();assert.equal(writes,1);
 console.log('PASS: role/tab notification routing, separate counters, read isolation, unseen arrivals preserved, control event watermark, no-op empty selection and badge reappearance.');
})().catch(error=>{console.error(error);process.exitCode=1});
