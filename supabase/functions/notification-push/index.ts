import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import {importPKCS8, SignJWT} from 'npm:jose@5.9.6';

// Called by an INSERT database webhook, never by the browser.
Deno.serve(async request=>{
  const secret=Deno.env.get('PUSH_WEBHOOK_SECRET');
  if(!secret||request.headers.get('x-push-secret')!==secret)return new Response('Unauthorized',{status:401});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  try{
    const event=await request.json();
    if(event.type!=='INSERT'||event.table!=='app_records'||event.record?.collection!=='notifications')return new Response('Ignored');
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:row,error}=await db.from('app_records').select('company_id,payload').eq('collection','notifications').eq('record_key',event.record.record_key).maybeSingle();
    if(error)throw error;
    if(!row||row.payload.lu)return new Response('Ignored');
    const {data:profiles,error:profileError}=await db.from('app_profiles').select('user_id,profile').eq('company_id',row.company_id).eq('is_active',true).eq('profile->>id',String(row.payload.userId));
    if(profileError)throw profileError;
    const recipients=(profiles||[]).filter(p=>String(p.profile.id)===String(row.payload.userId)).map(p=>p.user_id);
    if(!recipients.length)return new Response('No recipient');
    const {data:devices,error:deviceError}=await db.from('app_push_tokens').select('token,user_id').eq('company_id',row.company_id).in('user_id',recipients);
    if(deviceError)throw deviceError;
    if(!devices?.length)return new Response('No subscribed device');
    const account=JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
    const key=await importPKCS8(account.private_key,'RS256');
    const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'})
      .setProtectedHeader({alg:'RS256'}).setIssuer(account.client_email)
      .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
    const oauth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
    if(!oauth.ok)throw new Error('FCM authorization failed');
    const {access_token}=await oauth.json();
    let failures=0;
    for(const device of devices){
      const response=await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,{
        method:'POST',headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({message:{token:device.token,data:{title:'ITC Gestion Matériels',body:String(row.payload.message||'Nouvelle notification.').slice(0,500),notificationId:event.record.record_key,recipientUid:device.user_id,url:'./index.html'},webpush:{headers:{Urgency:'high',TTL:'86400'}}}})
      });
      if(!response.ok){
        const result=await response.json();
        if(result.error?.details?.some((d:{errorCode?:string})=>d.errorCode==='UNREGISTERED')){
          const removed=await db.from('app_push_tokens').delete().eq('token',device.token).eq('user_id',device.user_id);
          if(removed.error)failures++;
        }else failures++;
      }
    }
    return new Response(failures?'Push delivery incomplete':'Sent',{status:failures?502:200});
  }catch(error){console.error('Notification push failed',error instanceof Error?error.message:'Unknown error');return new Response('Push unavailable',{status:500});}
});
