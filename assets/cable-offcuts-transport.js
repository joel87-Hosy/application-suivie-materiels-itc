/* Callable protocol: authenticated stock operations must not depend on Web Push.
 * https://firebase.google.com/docs/functions/callable-reference
 */
(function(global) {
  'use strict';
  async function call(payload) {
    // Share the same client and session as application login, on every device.
    const supabaseConfig = global.ITCSupabaseConfig;
    const supabase = supabaseConfig?.client;
    if (!supabase) throw new Error('La configuration du site est incomplète. Faites publier la configuration Supabase commune à tous les appareils.');
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
