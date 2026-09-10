const fs = require('fs');
const assert = require('node:assert/strict');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const {SecureStore} = require('../assets/secure-store');
const {migrate} = require('../scripts/migrate_tenant_security');
let environment;
const profile = (uid, role, company_id = 'A', is_active = true) => ({uid, email:uid+'@example.test', role, company_id, is_active, user_id:uid === 'tech' ? 1 : 2});
async function main() {
  environment = await initializeTestEnvironment({projectId:'demo-itc-security', database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.json','utf8')}});
  const profiles = Object.fromEntries([
    profile('admin','SUPER_ADMIN','PLATFORM'), profile('inactiveAdmin','SUPER_ADMIN','PLATFORM',false),
    profile('supervisor','Superviseur'),profile('inactiveSupervisor','Superviseur','A',false),
    profile('manager','Gestionnaire'),profile('tech','Technicien'),profile('otherTech','Technicien'),
    profile('foreign','Superviseur','B'),profile('foreignTech','Technicien','B'),profile('disabled','Technicien','A',false),
  ].map(p => [p.uid,p]));
  const users = Object.fromEntries(Object.entries(profiles).map(([key,p]) => [key,{...p,id:p.user_id,name:key}]));
  await environment.withSecurityRulesDisabled(async context => context.database().ref().set({
    auth_profiles:profiles,
    tenant_branding:{A:{id:'A',name:'A',status:'active'},B:{id:'B',name:'B',status:'active'}},
    itc_data:{users,stock:{a:{company_id:'A',label:'Cable',qty:5},b:{company_id:'B',label:'Other',qty:8}},demandes:{other:{company_id:'A',demandeurOriginalId:2,status:'pending'}}},
  }));
  const client = uid => uid ? environment.authenticatedContext(uid).database() : environment.unauthenticatedContext().database();
  const scoped = (db, name, company = 'A') => db.ref('itc_data/'+name).orderByChild('company_id').equalTo(company);
  for (const uid of [null,'unknown','disabled','inactiveAdmin','inactiveSupervisor']) {
    await assertFails(scoped(client(uid),'stock').once('value'));
    await assertFails(client(uid).ref('itc_data/stock/a/qty').set(0));
  }
  const tech=client('tech'), supervisor=client('supervisor'), manager=client('manager'), admin=client('admin');
  await assertFails(tech.ref().once('value'));
  await assertFails(tech.ref('itc_data').once('value'));
  await assertFails(tech.ref('itc_data/stock').once('value'));
  const rows=(await assertSucceeds(scoped(tech,'stock').once('value'))).val();
  assert.deepEqual(Object.keys(rows),['a']);
  await assertFails(scoped(tech,'stock','B').once('value'));
  await assertFails(tech.ref('itc_data/stock/b').once('value'));
  await assertFails(tech.ref('itc_data/stock/a/qty').set(999));
  await assertSucceeds(manager.ref('itc_data/stock/a/qty').set(6));
  await assertFails(manager.ref('itc_data/stock/b/qty').set(0));
  await assertFails(manager.ref('itc_data/stock/a/company_id').set('B'));
  await assertFails(manager.ref('itc_data').set({stock:{}}));
  await assertFails(manager.ref('itc_data').remove());
  await assertFails(tech.ref('itc_data/users/tech/role').set('SUPER_ADMIN'));
  await assertFails(tech.ref('auth_profiles/tech/role').set('SUPER_ADMIN'));
  await assertSucceeds(tech.ref('itc_data/users/tech').update({phone:'010203',name:'New name'}));
  await assertFails(tech.ref('itc_data/users/otherTech/phone').set('fake'));
  await assertFails(supervisor.ref('auth_profiles/foreignTech').set(profile('foreignTech','Technicien','A')));
  await assertFails(supervisor.ref('auth_profiles/admin').remove());
  await assertFails(supervisor.ref('auth_profiles/tech/role').set('Superviseur'));
  await assertFails(supervisor.ref('auth_profiles/supervisor/is_active').set(true));
  await assertFails(client('inactiveSupervisor').ref('auth_profiles/tech/is_active').set(false));
  await assertFails(client('inactiveAdmin').ref('tenant_branding/A/status').set('active'));
  await assertFails(supervisor.ref('itc_data/users/tech/temporary_password').set('secret'));
  await assertFails(admin.ref('itc_data/users/tech/temporary_password').set('secret'));
  await assertSucceeds(tech.ref('itc_data/demandes/mine').set({company_id:'A',demandeurOriginalId:1,status:'EN ATTENTE COORDINATION'}));
  await assertFails(tech.ref('itc_data/demandes/mine/status').set('LIVREE'));
  await assertFails(tech.ref('itc_data/demandes/fake').set({company_id:'A',demandeurOriginalId:1,status:'LIVREE'}));
  await assertSucceeds(tech.ref('itc_data/notifications/n').set({company_id:'A',actorUid:'tech',userId:1,message:'Request sent',lu:false}));
  await assertSucceeds(tech.ref('itc_data/notifications/n/lu').set(true));
  await assertFails(tech.ref('itc_data/notifications/n/message').set('Forged audit'));
  await assertFails(tech.ref('itc_data/demandes/other/status').set('approved'));
  await assertSucceeds(admin.ref('itc_data/stock').once('value'));
  const techStore = new SecureStore(tech,()=>{},error=>{throw error;});
  await techStore.connect({uid:'tech'});
  const requestData=techStore.value();
  requestData.demandes.unshift({id:'request',demandeurOriginalId:1,status:'EN ATTENTE COORDINATION'});
  requestData.notifications.unshift({actorUid:'tech',userId:2,message:'New request',lu:false});
  await techStore.save(requestData);
  assert.equal(techStore.value().demandes[0].id,'request');
  techStore.stop();
  const managerStore = new SecureStore(manager,()=>{},error=>{throw error;});
  await managerStore.connect({uid:'manager'});
  const delivery=managerStore.value();
  delivery.stock[0].qty-=1;
  delivery.demandes.find(d=>d.id==='request').status='LIVREE';
  delivery.sorties.push({id:'delivery',items:[{label:'Cable',qty:1}]});
  await managerStore.save(delivery);
  managerStore.stop();
  // Exercise the real client adapter against the real rules, including deletion.
  let latest; const errors=[];
  const store = new SecureStore(supervisor, data => {latest=data;}, error => errors.push(error));
  await store.connect({uid:'supervisor'});
  let data=store.value();
  assert.ok(data.users.every(u => u.company_id === 'A'));
  data.users.push({...profile('newTech','Technicien'),id:10,name:'New colleague'});
  await store.save(data);
  assert.equal((await admin.ref('auth_profiles/newTech').once('value')).val().user_id,10);
  data=store.value();
  data.users.find(u => u.uid === 'otherTech').is_active = false;
  await store.save(data);
  assert.equal((await client('otherTech').ref('auth_profiles/otherTech').once('value')).val().is_active,false);
  await assertFails(scoped(client('otherTech'),'stock').once('value'));
  data=store.value();
  data.users=data.users.filter(u => u.uid !== 'otherTech');
  await store.save(data);
  assert.equal((await admin.ref('auth_profiles/otherTech').once('value')).val(),null);
  store.stop(); assert.equal(errors.length,0);
  await assertSucceeds(admin.ref('tenant_branding/A/status').set('suspended'));
  await assertFails(scoped(manager,'stock').once('value'));
  await assertFails(supervisor.ref('auth_profiles/tech/is_active').set(false));
  await assertFails(manager.ref('itc_data/stock/a/qty').set(0));
  // Migration is conservative, removes plaintext passwords and is idempotent.
  const source={auth_profiles:{t:profile('t','Technicien','COMP-ITC-LEGACY')},itc_data:{users:[{...profile('t','Technicien','COMP-ITC-LEGACY'),id:7,temporary_password:'secret'}],stock:[{qty:5}],materialTypes:['Cable']}};
  const migrated=migrate(source);
  assert.equal(migrated.itc_data.stock[0].company_id,'COMP-ITC-LEGACY');
  assert.equal(migrated.itc_data.users[0].temporary_password,undefined);
  assert.equal(source.itc_data.users[0].temporary_password,'secret');
  assert.deepEqual(migrate(migrated),migrated);
  console.log('PASS: tenant isolation, roles, escalation, suspensions, root deletion, plaintext passwords, personal profile, real adapter writes and migration.');
}
main().catch(error => {console.error(error);process.exitCode=1;}).finally(async()=>{if(environment) await environment.cleanup();});
