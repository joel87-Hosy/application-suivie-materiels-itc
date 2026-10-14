const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8').replace(/^\uFEFF/,'');

(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 await db.exec(migration('202609180002_app_backend.sql').split('DO $$')[0]);
 const coordinatorId='00000000-0000-0000-0000-000000000001',coordinator={id:1,uid:coordinatorId,role:'Coordinateur',name:'Konan Christian',company_id:'COMP-ITC-LEGACY',office:'B01',serviceAbbreviation:'MBM'};
 await db.query('INSERT INTO auth.users VALUES($1,$2)',[coordinatorId,'konanchristian@ivoiretechnocom.ci']);
 await db.query('INSERT INTO app_profiles(user_id,company_id,role,control_scopes,profile) VALUES($1,$2,$3,$4,$5)',[coordinatorId,coordinator.company_id,coordinator.role,{'ITC-B01':true},coordinator]);
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('users',$1,$2,$3)",[coordinatorId,coordinator.company_id,coordinator]);
 const precedingMigrations=[
  '202609180005_validator_workflow.sql','202609190001_validator_bureaus.sql','202609190004_unconditional_workflow.sql','202609190005_city_stocks.sql',
  '202609240001_repair_rejected_bon_actions.sql','202609240004_bureau02_substocks.sql','202609240005_explicit_substock_issues.sql','202609250002_bon_validity_scanner.sql',
  '202609260001_bon_drawn_signatures.sql','202609260002_account_affiliations.sql','202609260003_special_validation_routing.sql','202609260004_multiple_affiliations_choices.sql',
  '202609260005_account_affiliation_identity.sql','202609260006_verified_affiliation_identity.sql','202609270001_affiliation_contacts.sql','202609280001_bureau01_physical_services.sql',
  '202609290001_normalize_issue_stock_labels.sql','202609290001_server_authoritative_bon_dates.sql','202609290002_supervisor_terrain_affiliations.sql','202609290003_bureau01_issue_service_codes.sql',
  '202609290004_fix_bureau01_issue_service_validation.sql','202609290005_normalize_signed_issue_stock_match.sql','202609290006_bureau01_safe_stock_match.sql',
  '202609290007_remove_bureau01_pending_request.sql','202609290008_prefer_manager_bureau01_stock.sql','202609290009_debit_selected_stock_item.sql',
  '202609300001_remove_bureau02_pending_request.sql','202610010001_bureau01_coordinator_initial_service.sql','202610010001_coordinator_material_returns.sql',
  '202610010002_storekeeper_issue_workflow.sql','202610020001_bureau01_coordination_emitter_services.sql','202610030001_bureau01_account_creation_services.sql',
  '202610040001_remove_bureau01_pending_any_assigned_stock.sql','202610050001_allow_storekeeper_account_creation.sql','202610060001_move_remaining_firebase_services.sql',
  '202610060002_storekeeper_ont_nokia_exception.sql','202610060003_ont_nokia_label_match.sql','202610060004_fix_ont_nokia_case.sql','202610060005_bureau01_signed_immediate_debit.sql',
  '202610060006_storekeeper_max_three_offices.sql','202610070001_storekeeper_unavailable_items.sql',
  '202610070002_supervisor_terrain_material_requests.sql','202610080001_manager_substocks_b01.sql','202610080002_bureau01_transfer_services.sql',
  '202610080003_storekeeper_office_assignment.sql','202610080004_storekeeper_shared_b02_bons.sql','202610080005_remove_duplicate_coord_tech_bon.sql',
  '202610080006_konanchristian_cross_office_direct_order.sql','202610080007_scope_cross_office_to_named_account.sql'
 ];
 for(const name of precedingMigrations)await db.exec(migration(name));
 await db.exec(`DO $$
 DECLARE definition text;
 BEGIN
  SELECT pg_get_functiondef('public.register_company_user(uuid,uuid,text,text,text,text,text[])'::regprocedure) INTO definition;
  definition:=replace(definition,'actor.role NOT IN (''Superviseur'',''SUPER_ADMIN'')','actor.role NOT IN (''Superviseur'', ''DG'', ''SUPER_ADMIN'')');
   definition:=replace(definition,'''Coordinateur'',''Coordinatrice'',''Superviseur Terrain''','''Coordinateur'',''Magasinier'',''Coordinatrice'',''Superviseur Terrain''');
   IF position('DG' IN definition)=0 OR position('Magasinier' IN definition)=0 THEN RAISE EXCEPTION 'test setup did not add the DG guard and variant role list'; END IF;
   EXECUTE definition;
  END $$;`);
  await db.exec(`DO $$
  DECLARE definition text;
  BEGIN
   SELECT pg_get_functiondef('public.register_company_user_multi(uuid,uuid,text,text,text,text,text[],text[],text[],text[],text[])'::regprocedure) INTO definition;
   definition:=replace(definition,'''Coordinateur'',''Coordinatrice'',''Gestionnaire''','''Coordinateur'',''Magasinier'',''Coordinatrice'',''Gestionnaire''');
   IF position('Magasinier' IN definition)=0 THEN RAISE EXCEPTION 'test setup did not add the variant multi-role list'; END IF;
   EXECUTE definition;
  END $$;`);
 await db.exec(migration('202610130001_coordinator_v1_dual_office.sql'));
 const definitions=(await db.query(`SELECT p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('register_company_user','register_company_user_multi','set_account_affiliations','eligible_request_coordinator','account_affiliation_contacts','check_affiliation_contact','guard_account_affiliation','workflow_request_choices','guard_request_validation_office','change_company_user_role')`)).rows;
 assert.equal(definitions.length,10);
 for(const name of ['register_company_user','register_company_user_multi','set_account_affiliations','eligible_request_coordinator','account_affiliation_contacts','check_affiliation_contact','guard_account_affiliation','workflow_request_choices','guard_request_validation_office']) {
  assert.match(definitions.find(row=>row.proname===name).definition,/Coordinateur V1/,`${name} registers Coordinateur V1`);
 }
 assert.match(definitions.find(row=>row.proname==='change_company_user_role').definition,/CHANGE_COMPANY_USER_ROLE/);
 const addUser=async(id,role,firebaseUid)=>{
  const userId='00000000-0000-0000-0000-'+String(id).padStart(12,'0'),profile={id,uid:firebaseUid,role,name:'User '+id,company_id:'COMP-ITC-LEGACY'};
  await db.query('INSERT INTO auth.users VALUES($1,$2)',[userId,id+'@example.test']);
  await db.query('INSERT INTO app_profiles(user_id,firebase_uid,company_id,role,control_scopes,profile) VALUES($1,$2,$3,$4,$5,$6)',[userId,firebaseUid,profile.company_id,role,{},profile]);
  await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('users',$1,$2,$3)",[firebaseUid,profile.company_id,profile]);
  return userId;
 };
 const supervisor=await addUser(2,'Superviseur','supervisor-2');
 const target=await addUser(3,'Technicien','target-3');
 const stockOps=['ITC-B01','OCI','CIC','MTN','ITC-B02','MOOV'];
 await db.exec('SET ROLE service_role');
 await assert.rejects(db.query('SELECT change_company_user_role($1,$2,$3,$4,$5,$6,$7,$8)',[supervisor,'target-3','Coordinateur V1',stockOps,['B01'],['PROD'],[],[]]),/Affectation du Coordinateur V1 invalide/);
 await db.query('SELECT change_company_user_role($1,$2,$3,$4,$5,$6,$7,$8)',[supervisor,'target-3','Coordinateur V1',stockOps,['B01','B02'],['PROD','B2B'],[],[]]);
 await db.exec('RESET ROLE');
 const changed=(await db.query('SELECT role,control_scopes,profile FROM app_profiles WHERE user_id=$1',[target])).rows[0];
 assert.equal(changed.role,'Coordinateur V1');
 assert.deepEqual(changed.control_scopes,Object.fromEntries(stockOps.map(op=>[op,true])));
 assert.deepEqual(changed.profile.offices,['B01','B02']);
 assert.deepEqual(changed.profile.services,['PROD','B2B']);
 assert.equal((await db.query("SELECT payload->>'role' role FROM app_records WHERE collection='users' AND record_key='target-3'")).rows[0].role,'Coordinateur V1');
 assert.equal((await db.query("SELECT count(*)::int count FROM app_records WHERE collection='platformAuditLogs' AND payload->>'action'='CHANGE_COMPANY_USER_ROLE'")).rows[0].count,1);
 await db.close();
 console.log('PASS: Coordinator V1 migration, guarded role update, fixed stock scopes, affiliations, and audit log.');
})().catch(error=>{console.error(error);process.exitCode=1;});
