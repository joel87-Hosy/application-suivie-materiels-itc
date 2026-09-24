/* FCM transports messages; Supabase owns account/device subscriptions. */
(function(global) {
  const client = () => global.ITCSupabaseConfig?.client;
  const status = (message, error=false) => {
    const el=document.getElementById('push-notification-status');
    if(el){el.textContent=message;el.className=error?'text-sm text-red-700':'text-sm text-slate-600';}
  };
  let foregroundBound=false;
  async function register() {
    const backend=client();
    const {data,error}=await backend.auth.getUser();
    if(error||!data.user)throw new Error('Connectez-vous avant d’activer les notifications.');
    const token=await firebase.messaging().getToken({vapidKey:global.ITCPushConfig.vapidPublicKey,serviceWorkerRegistration:await navigator.serviceWorker.ready});
    if(!token)throw new Error('Aucun jeton de notification reçu.');
    const result=await backend.rpc('register_app_push_token',{device_token:token});
    if(result.error)throw new Error('Activation non enregistrée. Vérifiez le déploiement du service de notifications Supabase.');
    if(!foregroundBound){
      firebase.messaging().onMessage(async payload=>{
        const session=await backend.auth.getUser();
        if(session.data.user?.id!==payload.data?.recipientUid)return;
        const audio=document.getElementById('beep-sound');
        if(audio){audio.currentTime=0;audio.play()?.catch(()=>{});}
        navigator.vibrate?.([200,100,150]);
      });
      foregroundBound=true;
    }
  }
  global.refreshPushNotifications=async()=>{
    if(!client()||global.Notification?.permission!=='granted'||!global.firebase?.messaging)return;
    try{await register();}catch(error){status(error.message,true);}
  };
  global.enablePushNotifications=async button=>{
    if(button)button.disabled=true;
    try{
      if(!client()||!('Notification' in global)||!('serviceWorker' in navigator)||!global.firebase?.messaging)throw new Error('Notifications non disponibles dans ce navigateur.');
      if(!global.ITCPushConfig?.vapidPublicKey)throw new Error('Clé Web Push non configurée.');
      if(await Notification.requestPermission()!=='granted')throw new Error('Autorisez les notifications dans les réglages du navigateur.');
      await register();
      status('Appareil inscrit aux notifications. Le son dépend des réglages du téléphone ou du navigateur.');
    }catch(error){status(error.message,true);}finally{if(button)button.disabled=false;}
  };
  global.disablePushNotifications=async()=>{
    if(!global.firebase?.messaging||global.Notification?.permission!=='granted')return;
    await firebase.messaging().deleteToken();
  };
})(window);
