const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202609180002_app_backend.sql','utf8').split('DO $$')[0]);
 const migration=fs.readFileSync('supabase/migrations/202609240002_push_subscriptions.sql','utf8');await db.exec(migration);await db.exec(migration);
 const uid='00000000-0000-0000-0000-000000000007';
 await db.query('INSERT INTO auth.users VALUES($1)',[uid]);
 await db.query("INSERT INTO app_profiles(user_id,company_id,role,profile) VALUES($1,'A','Gestionnaire','{\"id\":7}')",[uid]);
 await db.query("SELECT set_config('test.uid',$1,false)",[uid]);await db.exec('SET ROLE authenticated');
 await assert.rejects(db.exec("SELECT register_app_push_token('short')"),/invalide/);
 await db.exec("SELECT register_app_push_token('device-token-long-enough');SELECT register_app_push_token('device-token-long-enough');");
 await assert.rejects(db.exec('SELECT * FROM app_push_tokens'),/permission/);
 await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int n FROM app_push_tokens')).rows[0].n,1);
 await db.exec('UPDATE app_profiles SET is_active=false;SET ROLE authenticated');await assert.rejects(db.exec("SELECT register_app_push_token('device-token-long-enough')"),/actif/);
 await db.close();
 // Exercise webhook routing and FCM failures without real credentials/network.
 let handler,read=false,active=true,sendStatus=200,removed=false;
 const sent=[];
 const dbMock={from(table){const query={select(){return this;},eq(){return this;},in(){return this;},delete(){removed=true;return this;},maybeSingle(){return Promise.resolve({data:{company_id:'A',payload:{userId:7,lu:read,message:'Commande'}}});},then(resolve){resolve({data:table==='app_profiles'?(active?[{user_id:uid,profile:{id:'7'}}]:[]):[{token:'token',user_id:uid}]});}};return query;}};
 class JWT{setProtectedHeader(){return this;}setIssuer(){return this;}setAudience(){return this;}setIssuedAt(){return this;}setExpirationTime(){return this;}async sign(){return 'signed';}}
 const context={Response,URLSearchParams,console,createClient:()=>dbMock,importPKCS8:async()=>({}),SignJWT:JWT,Deno:{env:{get:name=>({PUSH_WEBHOOK_SECRET:'secret',FCM_SERVICE_ACCOUNT:JSON.stringify({private_key:'key',client_email:'account',project_id:'itc-erp'})}[name]||'test')},serve:fn=>handler=fn},fetch:async(url,options)=>{
   if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'access'})};
   sent.push(JSON.parse(options.body));return {ok:sendStatus===200,json:async()=>({error:{details:[{errorCode:sendStatus===404?'UNREGISTERED':'UNAVAILABLE'}]}})};
 }};
 vm.createContext(context);
 const source=fs.readFileSync('supabase/functions/notification-push/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),context);
 const call=(secret='secret',collection='notifications')=>handler(new Request('https://example.test',{method:'POST',headers:{'x-push-secret':secret},body:JSON.stringify({type:'INSERT',table:'app_records',record:{record_key:'n1',collection}})}));
 assert.equal((await call('wrong')).status,401);await call('secret','stock');assert.equal(sent.length,0);
 read=true;await call();assert.equal(sent.length,0);read=false;active=false;await call();assert.equal(sent.length,0);active=true;
 assert.equal((await call()).status,200);assert.equal(sent[0].message.data.recipientUid,uid);assert.equal(sent[0].message.webpush.headers.Urgency,'high');
 sendStatus=503;assert.equal((await call()).status,502);assert.equal(removed,false);
 sendStatus=404;assert.equal((await call()).status,200);assert.equal(removed,true);
 let foreground,beeps=0,deleted=0,registered=0,currentUid=uid;
 const status={};
 const messaging={getToken:async()=> 'device-token-long-enough',deleteToken:async()=>{deleted++;},onMessage:fn=>foreground=fn};
 const browser={console,document:{getElementById:id=>id==='beep-sound'?{play:()=>{beeps++;return Promise.resolve();}}:status},navigator:{serviceWorker:{ready:Promise.resolve({})},vibrate(){}},Notification:{permission:'granted',requestPermission:async()=> 'granted'},firebase:{messaging:()=>messaging},ITCPushConfig:{vapidPublicKey:'key'},ITCSupabaseConfig:{client:{auth:{getUser:async()=>({data:{user:{id:currentUid}}})},rpc:async(name,args)=>{assert.equal(name,'register_app_push_token');assert.equal(args.device_token,'device-token-long-enough');registered++;return {};}}}};
 browser.window=browser;vm.createContext(browser);vm.runInContext(fs.readFileSync('assets/push-notifications.js','utf8'),browser);
 const button={};await browser.enablePushNotifications(button);assert.equal(registered,1);assert.equal(button.disabled,false);
 await foreground({data:{recipientUid:uid}});assert.equal(beeps,1);
 currentUid='other';await foreground({data:{recipientUid:uid}});assert.equal(beeps,1,'previous account cannot ring in current session');
 await browser.disablePushNotifications();assert.equal(deleted,1);
 console.log('PASS: push subscription permissions, webhook authentication, recipient filtering, FCM errors, foreground beep and logout token invalidation.');
})().catch(error=>{console.error(error);process.exitCode=1});
