import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';

// Invoked by the app_records INSERT webhook. Delivery is standard Web Push;
// Firebase Messaging credentials and tokens are no longer used.
Deno.serve(async request=>{
  const secret=Deno.env.get('PUSH_WEBHOOK_SECRET');
  if(!secret||request.headers.get('x-push-secret')!==secret)return new Response('Unauthorized',{status:401});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  try{
    const publicKey=Deno.env.get('VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('VAPID_PRIVATE_KEY');
    if(!publicKey||!privateKey)throw new Error('Web Push VAPID keys are not configured');
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')||'mailto:admin@example.com',publicKey,privateKey);
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
    const {data:devices,error:deviceError}=await db.from('app_push_subscriptions').select('endpoint,user_id,subscription').eq('company_id',row.company_id).in('user_id',recipients);
    if(deviceError)throw deviceError;
    if(!devices?.length)return new Response('No subscribed device');
    const message=JSON.stringify({title:'ITC Gestion Matériels',body:String(row.payload.message||'Nouvelle notification.').slice(0,500),notificationId:event.record.record_key,url:'./index.html'});
    let failures=0;
    for(const device of devices){
      try{await webpush.sendNotification(device.subscription,message,{TTL:86400,urgency:'high'});}
      catch(error){
        const statusCode=(error as {statusCode?:number}).statusCode;
        if(statusCode===404||statusCode===410){const removed=await db.from('app_push_subscriptions').delete().eq('endpoint',device.endpoint);if(removed.error)failures++;}
        else failures++;
      }
    }
    return new Response(failures?'Push delivery incomplete':'Sent',{status:failures?502:200});
  }catch(error){console.error('Notification push failed',error instanceof Error?error.message:'Unknown error');return new Response('Push unavailable',{status:500});}
});
