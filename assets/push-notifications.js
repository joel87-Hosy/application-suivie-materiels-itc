(function(global){
  'use strict';
  const client=()=>global.ITCSupabaseConfig?.client;
  const status=(message,error=false)=>{const el=document.getElementById('push-notification-status');if(el){el.textContent=message;el.className=error?'text-sm text-red-700':'text-sm text-slate-600';}};
  const decodeKey=value=>{const padded=(value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));};
  async function subscribe(){
    const backend=client();if(!backend)throw new Error('Connexion Supabase indisponible.');
    const {data,error}=await backend.auth.getUser();if(error||!data.user)throw new Error('Connectez-vous avant d’activer les notifications.');
    const key=global.ITCPushConfig?.vapidPublicKey;if(!key)throw new Error('La clé publique Web Push doit être configurée.');
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(key)});
    const result=await backend.rpc('register_app_push_subscription',{push_subscription:subscription.toJSON()});
    if(result.error)throw result.error;
    return subscription;
  }
  global.refreshPushNotifications=async()=>{
    if(!client()||global.Notification?.permission!=='granted')return;
    try{await subscribe();}catch(error){status(error.message,true);}
  };
  global.enablePushNotifications=async button=>{
    if(button)button.disabled=true;
    try{
      if(!client()||!('Notification'in global)||!('serviceWorker'in navigator)||!('PushManager'in global))throw new Error('Notifications Web Push non disponibles dans ce navigateur.');
      if(!global.ITCPushConfig?.vapidPublicKey)throw new Error('La clé publique Web Push doit être configurée.');
      if(await Notification.requestPermission()!=='granted')throw new Error('Autorisez les notifications dans les réglages du navigateur.');
      await subscribe();status('Appareil inscrit aux notifications.');
    }catch(error){status(error.message,true);}finally{if(button)button.disabled=false;}
  };
  global.disablePushNotifications=async()=>{
    const registration=await navigator.serviceWorker?.ready;if(!registration)return;
    const subscription=await registration.pushManager.getSubscription();if(!subscription)return;
    await client()?.rpc('remove_app_push_subscription',{endpoint_value:subscription.endpoint});
    await subscription.unsubscribe();
  };
})(window);
