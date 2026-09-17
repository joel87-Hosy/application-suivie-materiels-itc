/* Callable protocol: authenticated stock operations must not depend on Web Push.
 * https://firebase.google.com/docs/functions/callable-reference
 */
(function(global) {
  'use strict';
  async function call(payload) {
    const user=firebase.auth().currentUser;
    if(!user)throw new Error('Reconnectez-vous pour accéder aux stocks de chutes.');
    const project=firebase.app().options.projectId;
    if(!/^[a-z0-9-]+$/.test(project||''))throw new Error('Configuration du service de stocks invalide.');
    const token=await user.getIdToken();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),65000);
    try {
      const response=await fetch('https://europe-west1-'+project+'.cloudfunctions.net/cableOffcuts',{
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify({data:payload}),signal:controller.signal,
      });
      if(response.status===404)throw new Error('Le service des stocks de chutes n’est pas encore disponible sur le serveur. Son activation est nécessaire.');
      const body=await response.json().catch(()=>null);
      if(!response.ok || body?.error)throw new Error(body?.error?.message || 'Le service des stocks de chutes est indisponible. Réessayez.');
      if(!body || (!Object.hasOwn(body,'result')&&!Object.hasOwn(body,'data')))throw new Error('Réponse du service de stocks invalide.');
      return Object.hasOwn(body,'result')?body.result:body.data;
    } catch(error) {
      if(error.name==='AbortError')throw new Error('Le serveur met trop de temps à répondre. Réessayez la même opération.');
      if(error instanceof TypeError)throw new Error('Connexion au service de stocks impossible. Vérifiez votre connexion ou faites vérifier son activation.');
      throw error;
    } finally {clearTimeout(timeout);}
  }
  global.CableOffcutsTransport={call};
})(window);
