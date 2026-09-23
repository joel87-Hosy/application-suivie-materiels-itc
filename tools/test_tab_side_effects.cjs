const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('index.html','utf8');
function extract(name){const start=source.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0);return source.slice(start,source.indexOf('\n      }',start)+'\n      }'.length);}
(async()=>{
 let saves=0,updates=0;
 const context={window:{},appData:{derniereDateScan:'yesterday',scansDuJour:[{id:'OLD'}],demandes:[{id:'BON',demandeurName:'Équipe',status:'EN ATTENTE VALIDATEUR'}]},save:async()=>{saves++;return true},document:{getElementById:()=>null},navigator:{},setTimeout:()=>{},console};
 vm.createContext(context);vm.runInContext(fs.readFileSync('assets/notification-tabs.js','utf8'),context);vm.runInContext(extract('verifierReinitialisationQuotidienne')+'\n'+extract('handleScanSuccess'),context);
 context.verifierReinitialisationQuotidienne();assert.equal(saves,0,'opening scanner does not save');assert.equal(context.appData.scansDuJour.length,0);
 await context.handleScanSuccess('BON');assert.equal(saves,1);assert.ok(context.appData.scansDuJour[0].heure);
 await context.handleScanSuccess('BON');assert.equal(saves,1,'same scan not saved twice');
 context.currentUser={id:7};context.appData.notifications=[{_dbKey:'own',userId:7,lu:false},{_dbKey:'other',userId:8,lu:false}];
 context.secureStore={markNotificationsRead:async()=>['own']};context.updateNotifications=()=>updates++;
 vm.runInContext('let pendingSave=null;let markingNotifications=false;'+extract('markNotificationsAsRead'),context);
 await context.markNotificationsAsRead();assert.equal(context.appData.notifications[0].lu,true);assert.equal(context.appData.notifications[1].lu,false);assert.equal(saves,1,'notification read never invokes general save');assert.equal(updates,1);
 console.log('PASS: scanner navigation has no writes, valid scan clock format, duplicate scans, targeted notification UI update.');
})().catch(e=>{console.error(e);process.exitCode=1});
