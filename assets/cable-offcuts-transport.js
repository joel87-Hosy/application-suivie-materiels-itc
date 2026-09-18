/* Callable protocol: authenticated stock operations must not depend on Web Push.
 * https://firebase.google.com/docs/functions/callable-reference
 */
(function(global) {
  'use strict';
  async function call(payload) {
    const publishableKey = String(global.localStorage?.getItem('itc_supabase_publishable_key') || '').trim();
    const supabaseConfig = global.ITCSupabaseConfig || (publishableKey && global.supabase ? {
      projectUrl: 'https://ufstydudgffhbkkjtbbg.supabase.co',
      publishableKey,
      client: global.supabase.createClient('https://ufstydudgffhbkkjtbbg.supabase.co', publishableKey),
    } : null);
    const supabase = supabaseConfig?.client;
    if (!supabase) throw new Error('Supabase n’est pas configuré pour les stocks de chutes. Rechargez l’application après avoir enregistré la clé publique.');
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) throw new Error('Reconnectez-vous pour accéder aux stocks de chutes.');
    const response = await fetch(supabaseConfig.projectUrl + '/functions/v1/cable-offcuts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + sessionData.session.access_token,
        'apikey': supabaseConfig.publishableKey,
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error) throw new Error(body?.error || 'Le service Supabase des stocks de chutes est indisponible.');
    return body;
  }
  global.CableOffcutsTransport={call};
})(window);
