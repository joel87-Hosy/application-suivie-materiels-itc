/* Public Supabase client configuration. Never place a service-role key here. */
(function (global) {
  const projectUrl = global.ITCSupabasePublicConfig?.projectUrl || "https://ufstydudgffhbkkjtbbg.supabase.co";
  let legacyKey = "";
  try { legacyKey = global.localStorage?.getItem("itc_supabase_publishable_key") || ""; } catch (_) {}
  const publishableKey = String(
    global.ITCSupabasePublicConfig?.publishableKey || global.ITC_SUPABASE_PUBLISHABLE_KEY ||
      legacyKey ||
      "",
  ).trim();
  const storageKey = `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`;
  // Bound the logout request even when the network does not respond.
  const authFetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url?.startsWith(projectUrl + '/auth/v1/logout')) return global.fetch(input, options);
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        global.fetch(input, {...options, signal:controller.signal}),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Délai de déconnexion serveur dépassé.')); }, 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const clearLocalSession = () => {
    for (const suffix of ['', '-code-verifier', '-user']) {
      try { global.localStorage?.removeItem(storageKey + suffix); } catch (_) {}
    }
  };
  // A reload during logout must not restore the session still being revoked.
  try { if (global.sessionStorage?.getItem('itc_signed_out') === '1') clearLocalSession(); } catch (_) {}
  const client = publishableKey && global.supabase
    ? global.supabase.createClient(projectUrl, publishableKey, {auth:{storageKey}, global:{fetch:authFetch}})
    : null;

  global.ITCSupabaseConfig = {
    projectUrl,
    publishableKey,
    isConfigured: Boolean(client),
    client,
    clearLocalSession,
  };
})(window);
