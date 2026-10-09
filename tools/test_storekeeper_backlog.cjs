const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/202610090002_cancel_storekeeper_pending_bon.sql','utf8');
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');

(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.app_profiles(user_id uuid PRIMARY KEY,company_id text,role text,profile jsonb,control_scopes jsonb);
 CREATE TABLE public.app_records(collection text,record_key text,company_id text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(collection,record_key));
 GRANT SELECT ON public.app_records TO authenticated;
 CREATE FUNCTION public.current_app_profile() RETURNS public.app_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
 DECLARE actor public.app_profiles; BEGIN SELECT * INTO actor FROM public.app_profiles WHERE user_id=auth.uid(); RETURN actor; END $$;
 CREATE FUNCTION public.workflow_op(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(trim(value)) $$;
 CREATE FUNCTION public.storekeeper_covers_request(profile jsonb,scopes jsonb,company_id text,request jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT profile->>'office'=request->>'originOffice' $$;`);
 await db.exec(migration);

 const storekeeper=uuid(1);
 await db.query('INSERT INTO app_profiles VALUES($1,$2,$3,$4,$5)',[storekeeper,'A','Magasinier',{name:'Magasinier',office:'B01'},{'ITC-B01':true}]);
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock','stock-1','A',$1)",[{
  op:'ITC-B01',label:'CABLE',qty:5,subStocks:{production:3,deploiement:2,maintenance:0},
 }]);
 const bon={
  id:'BON-PARTIEL',status:'PARTIELLEMENT SERVI',company_id:'A',originOffice:'B01',
  validatorDecision:{approved:true},managerSignedAt:'2026-10-09T08:00:00Z',managerDebitAt:'2026-10-09T08:05:00Z',
  items:[{op:'ITC-B01',label:'CABLE',qty:5,substock:'production'}],
  managerDebitItems:[{index:0,stockKey:'stock-1',op:'ITC-B01',label:'CABLE',qty:5,substock:'production'}],
  materialService:{servedByItem:{'0':{qty:2,stockKey:'stock-1'}},events:[]},
 };
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes','request-1','A',$1)",[bon]);
 await db.query("SELECT set_config('test.uid',$1,false)",[storekeeper]);
 await db.exec('SET ROLE authenticated');
 const cancelled=(await db.query("SELECT cancel_storekeeper_pending_bon('request-1','BON-PARTIEL',$1::timestamptz) AS result",['2026-10-09T08:05:00Z'])).rows[0].result;
 assert.equal(cancelled.status,'ANNULEE MAGASINIER');
 assert.equal(cancelled.storekeeperCancellation.restoredItems[0].qty,3);
 const restored=(await db.query("SELECT payload FROM app_records WHERE collection='stock' AND record_key='stock-1'")).rows[0].payload;
 assert.equal(restored.qty,8);
 assert.equal(restored.subStocks.production,6);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM app_records WHERE collection='stockMovements' AND payload->>'source'='storekeeper_bon_cancellation'")).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM app_records WHERE collection='platformAuditLogs' AND payload->>'action'='ANNULATION_BON_MAGASINIER'")).rows[0].n,1);
 await assert.rejects(db.query("SELECT cancel_storekeeper_pending_bon('request-1','BON-PARTIEL',$1::timestamptz)",['2026-10-09T08:05:00Z']),/plus en attente|modifié/);

 const wrongOffice={...bon,id:'BON-HORS-BUREAU',status:'EN ATTENTE MAGASINIER',originOffice:'B02',managerDebitItems:undefined,managerDebitAt:undefined,materialService:{servedByItem:{},events:[]}};
 await db.exec('RESET ROLE');
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes','request-2','A',$1)",[wrongOffice]);
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('stock','stock-2','A',$1)",[{
  op:'ITC-B01',label:'ROUTEUR',qty:8,subStocks:{production:4,deploiement:4,maintenance:0},
 }]);
 const unknownSubstockBon={...bon,id:'BON-SUBSTOCK-INCONNU',status:'EN ATTENTE MAGASINIER',
  items:[{op:'ITC-B01',label:'ROUTEUR',qty:2}],
  managerDebitItems:[{index:0,stockKey:'stock-2',op:'ITC-B01',label:'ROUTEUR',qty:2}],
  materialService:{servedByItem:{},events:[]}};
 await db.query("INSERT INTO app_records(collection,record_key,company_id,payload) VALUES('demandes','request-3','A',$1)",[unknownSubstockBon]);
 await db.exec('SET ROLE authenticated');
 await assert.rejects(db.query("SELECT cancel_storekeeper_pending_bon('request-2','BON-HORS-BUREAU',NULL)"),/hors de votre bureau/);
 await assert.rejects(db.query("SELECT cancel_storekeeper_pending_bon('request-3','BON-SUBSTOCK-INCONNU',$1::timestamptz)",['2026-10-09T08:05:00Z']),/répartition du débit dans les sous-stocks est inconnue/);
 assert.equal((await db.query("SELECT payload->>'qty' AS qty FROM app_records WHERE collection='stock' AND record_key='stock-2'")).rows[0].qty,'8');

 const today=new Date(),yesterday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1,12);
 const atLocalNoon=date=>new Date(date.getFullYear(),date.getMonth(),date.getDate(),12).toISOString();
 const profile={uid:'storekeeper',role:'Magasinier',name:'Magasinier',office:'B01'};
 const demands=[
  {id:'TODAY-BON',ref:'TODAY-ONLY',originOffice:'B01',managerSignedAt:atLocalNoon(today),status:'EN ATTENTE MAGASINIER',items:[{op:'ITC-B01',label:'CABLE',qty:2}]},
  {id:'PAST-BON',ref:'PAST-ONLY',originOffice:'B01',managerSignedAt:atLocalNoon(yesterday),status:'EN ATTENTE MAGASINIER',items:[{op:'ITC-B01',label:'CABLE',qty:2}]},
 ];
 const window={AccountAffiliation:{officeList:()=>['B01'],requestOffice:bon=>bon.originOffice},BonReference:{format:bon=>bon.ref},confirm:()=>true,alert(){}};
 const scannerContext=vm.createContext({window});
 vm.runInContext(fs.readFileSync('assets/storekeeper-backlog.js','utf8'),scannerContext);
 window.StorekeeperBacklog.setup({profile:()=>profile,data:()=>({demandes:demands,users:[],stock:[]})});
 const container={innerHTML:'',isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
 const todayValue=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
 const yesterdayValue=`${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
 window.StorekeeperBacklog.render(container);
 assert.match(container.innerHTML,new RegExp(`data-date-filter[^>]*value="${todayValue}"`));
 assert.match(container.innerHTML,/TODAY-ONLY/);
 assert.doesNotMatch(container.innerHTML,/PAST-ONLY/);
 window.StorekeeperBacklog.render(container,yesterdayValue);
 assert.match(container.innerHTML,/PAST-ONLY/);
 assert.doesNotMatch(container.innerHTML,/TODAY-ONLY/);
 assert.match(container.innerHTML,/data-delete-index/);

 await db.close();
 console.log('PASS: current-day default and historical date filter; audited storekeeper cancellation restores only the undelivered manager debit, including its substock; office scope and repeat cancellation rejected.');
})().catch(error=>{console.error(error);process.exitCode=1});
