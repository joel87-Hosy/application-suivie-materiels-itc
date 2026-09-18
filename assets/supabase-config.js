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
  const client = publishableKey && global.supabase
    ? global.supabase.createClient(projectUrl, publishableKey)
    : null;

  global.ITCSupabaseConfig = {
    projectUrl,
    publishableKey,
    isConfigured: Boolean(client),
    client,
  };
})(window);
