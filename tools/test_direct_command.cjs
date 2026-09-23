const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('node:crypto');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.search(new RegExp('^      (?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n      }',start)+8);}
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON app_records TO authenticated;');
 for(const name of ['202609180005_validator_workflow.sql','202609190001_validator_bureaus.sql','202609190004_unconditional_workflow.sql'])await db.exec(migration(name));
 for(const [id,role,ops] of [[1,'Coordinateur',['ITC-B01','ITC-B02']],[2,'Validateur',['ITC-B01']],[3,'Validatrice',['ITC-B02']],[4,'Gestionnaire',['ITC-B01']],[5,'Gestionnaire',['ITC-B02']],[6,'Coordinatrice',['ITC-B01','ITC-B02']]]){
  await db.query('INSERT INTO auth.users VALUES($1,$2)',[uuid(id),id+'@test']);
  await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,profile) VALUES($1,\'A\',$2,$3,$4)',[uuid(id),role,JSON.stringify(Object.fromEntries(ops.map(op=>[op,true]))),JSON.stringify({id,name:role})]);
 }
 const stock=[{company_id:'A',op:'ITC-B01',label:'CABLE',qty:20},{company_id:'A',op:'ITC-B02',label:'ONT',qty:30}];
 for(const s of stock)await db.query("INSERT INTO app_records VALUES('stock',$1,'A',$2,now())",[s.op,JSON.stringify(s)]);
 const as=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.uid',$1,false)",[uuid(id)]);await db.exec('SET ROLE authenticated');};
 const fields={'s-service':'DEP','s-ref':'Chantier test','s-tech':'Equipe test','s-emetteur':'Coordination','s-coordination-signature':'Signature coordination'};
 let saves=0;const alerts=[];
 const context={currentSectionId:'coord-creation-directe',currentUser:{id:1,uid:uuid(1),company_id:'A',role:'Coordinateur',name:'Coordination'},secureStore:{uid:uuid(1),profile:{role:'Coordinateur'}},appData:{stock:structuredClone(stock),demandes:[]},
  getCheckedSortieOperators:()=>['ITC-B01','ITC-B02'],isOperatorAllowedForUser:()=>true,getFormTextValue:id=>fields[id],BonReference:{services:{DEP:true}},getTodayDateInputValue:()=> '2026-09-23',formatDateInputAsLocaleString:()=>'',getSelectedSortieItemsFromPicker:()=>[{op:'ITC-B01',label:'CABLE',qty:2},{op:'ITC-B02',label:'ONT',qty:3}],normalizeOperatorKey:v=>v,
  document:{getElementById:()=>null},window:{ValidatorWorkflow:{enabled:()=>false}},crypto:{randomUUID},localStorage:{removeItem(){}},alert:msg=>alerts.push(msg),showSection(){},save:async()=>{saves++;for(const d of context.appData.demandes)await db.query("INSERT INTO app_records VALUES('demandes',$1,'A',$2,now()) ON CONFLICT DO NOTHING",[d.id,JSON.stringify({...d,company_id:'A'})]);return true;}};
 vm.createContext(context);vm.runInContext(extract('getSortieDraftStorageKey')+'\n'+extract('handleSortiePhysique'),context);
 for(const [id,role] of [[1,'Coordinateur'],[6,'Coordinatrice']]){
  await as(id);context.currentUser.id=id;context.currentUser.role=role;context.secureStore.profile.role=role;context.appData.demandes=[];
  await context.handleSortiePhysique({preventDefault(){}},true);
  assert.equal(context.appData.demandes.length,2);assert.deepEqual(context.appData.stock,stock,'submission does not debit stock');
  for(const d of context.appData.demandes){assert.equal(d.status,'EN ATTENTE VALIDATEUR');assert.equal(d.serviceAbbreviation,'DEP');assert.equal(d.coordinationSignatureText,fields['s-coordination-signature']);assert.equal(d.assignedGestionnaireUid,undefined);}
 }
 assert.equal(saves,2);
 const [first,second]=context.appData.demandes;
 await as(4);await assert.rejects(db.query("SELECT issue_validated_request($1,'Signature','DEP')",[first.id]));
 await as(2);await assert.rejects(db.query("SELECT decide_stock_request($1,true,$2,'')",[second.id,uuid(5)]),/bureau/);
 await db.query("SELECT decide_stock_request($1,true,$2,'')",[first.id,uuid(4)]);
 await as(3);await db.query("SELECT decide_stock_request($1,true,$2,'')",[second.id,uuid(5)]);
 await as(4);await assert.rejects(db.query("SELECT issue_validated_request($1,'Signature','DEP')",[second.id]));await db.query("SELECT issue_validated_request($1,'Signature','DEP')",[first.id]);
 await as(5);await db.query("SELECT issue_validated_request($1,'Signature','DEP')",[second.id]);
 assert.deepEqual((await db.query("SELECT (payload->>'qty')::int qty FROM app_records WHERE collection='stock' ORDER BY record_key")).rows.map(r=>r.qty),[18,27]);
 assert.equal((await db.query("SELECT count(*)::int n FROM app_records WHERE collection='sorties'")).rows[0].n,2);
 fields['s-coordination-signature']='';await context.handleSortiePhysique({preventDefault(){}},true);assert.equal(saves,2);
 const directKey=context.getSortieDraftStorageKey();context.currentSectionId='sortie-physique';assert.notEqual(context.getSortieDraftStorageKey(),directKey);
 assert.match(extract('renderCoordCreationDirecte'),/renderSortiePhysiqueForm\(container, true\)/);
 await db.close();console.log('PASS: both coordination roles use physical-bon form, per-stock validator routing, signature/service, no early debit, dedicated manager issue and isolated drafts.');
})().catch(error=>{console.error(error);process.exitCode=1});
