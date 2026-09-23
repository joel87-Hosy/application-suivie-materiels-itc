import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({error:'Méthode non autorisée.'},405);
 try{
  const header=request.headers.get('Authorization');if(!header)return json({error:'Connexion requise.'},401);
  const url=Deno.env.get('SUPABASE_URL')!;
  const session=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:header}}});
  const {data:auth,error:authError}=await session.auth.getUser();if(authError||!auth.user)return json({error:'Session expirée.'},401);
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:actor,error:actorError}=await admin.from('app_profiles').select('role,company_id,is_active').eq('user_id',auth.user.id).single();
  if(actorError||!actor?.is_active||!['Superviseur','DG','SUPER_ADMIN'].includes(actor.role))return json({error:'Gestion des comptes réservée au directeur.'},403);
  const c=await request.json();
  if(typeof c.companyId!=='string'||(actor.role!=='SUPER_ADMIN'&&c.companyId!==actor.company_id))return json({error:'Entreprise non autorisée.'},403);
  if(c.action && c.action!=='create'){
   if(!['suspend','disable','activate','delete'].includes(c.action)||typeof c.targetUid!=='string'||!c.targetUid||c.targetUid.length>200||typeof c.operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.operationId))return json({error:'Action ou compte invalide.'},400);
   const {data:operation,error:prepareError}=await admin.rpc('prepare_company_account_action',{actor_id:auth.user.id,target_key:c.targetUid,action:c.action,operation_id:c.operationId});
   if(prepareError||!operation)return json({error:prepareError?.message||'Action refusée.'},400);
   if(operation.status==='complete')return json({updated:true,action:c.action});
   const result=c.action==='delete'
    ? await admin.auth.admin.deleteUser(operation.target_id)
    : await admin.auth.admin.updateUserById(operation.target_id,{ban_duration:c.action==='activate'?'none':'876000h'});
   if(result.error && !(c.action==='delete' && result.error.code==='user_not_found'))return json({error:'Le compte reste bloqué dans l’application. Synchronisation Auth à terminer : '+result.error.message},503);
   const {error:finishError}=await admin.rpc('finish_company_account_action',{actor_id:auth.user.id,operation_id:operation.id});
   if(finishError)return json({error:'Synchronisation à terminer. Réessayez la même action : '+finishError.message},503);
   return json({updated:true,action:c.action});
  }
  if(!['Gestionnaire','Contrôleur','Coordinateur','Coordinatrice','Superviseur Terrain','Technicien','Validateur','Validatrice'].includes(c.role))return json({error:'Rôle non autorisé.'},400);
  if(typeof c.email!=='string'||!/^\S+@\S+\.\S+$/.test(c.email)||typeof c.name!=='string'||!c.name.trim()||c.name.length>120||typeof c.password!=='string'||c.password.length<12||c.password.length>128)return json({error:'Nom, email ou mot de passe invalide (12 caractères minimum).'},400);
  if(!Array.isArray(c.managedOps)||c.managedOps.some((op:unknown)=>typeof op!=='string'))return json({error:'Liste de stocks invalide.'},400);
  const ops=c.role==='Contrôleur'?[]:[...new Set(c.managedOps)];
  if(['Gestionnaire','Validateur','Validatrice'].includes(c.role)&&!ops.length)return json({error:'Sélectionnez au moins un stock.'},400);
  const {data:locations,error:locationError}=await admin.from('stock_locations').select('op').eq('company_id',c.companyId);
  if(locationError||ops.some(op=>!locations?.some(row=>row.op===op)))return json({error:'Stock inconnu ou hors de cette entreprise.'},400);
  const {data:created,error:createError}=await admin.auth.admin.createUser({email:c.email.trim().toLowerCase(),password:c.password,email_confirm:true,user_metadata:{name:c.name.trim()}});
  if(createError||!created.user)return json({error:createError?.message||'Création impossible.'},400);
  const {error:registrationError}=await admin.rpc('register_company_user',{actor_id:auth.user.id,new_user_id:created.user.id,company:c.companyId,user_role:c.role,user_name:c.name.trim(),user_email:c.email.trim().toLowerCase(),stock_ops:ops});
  if(registrationError){
   // A lost RPC response can follow a committed transaction. Never remove that account.
   const {data:existing,error:lookupError}=await admin.from('app_profiles').select('user_id').eq('user_id',created.user.id).maybeSingle();
   if(existing)return json({id:created.user.id,created:true});
   if(lookupError)return json({error:'Création à vérifier. Actualisez la liste des comptes avant de réessayer.'},503);
   const {error:cleanupError}=await admin.auth.admin.deleteUser(created.user.id);
   return json({error:cleanupError?'Profil non créé. Contactez le superviseur pour vérifier le compte Auth.':registrationError.message},400);
  }
  return json({id:created.user.id,created:true});
 }catch{return json({error:'Le service de création de comptes est indisponible. Réessayez.'},500);}
});
