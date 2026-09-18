/* Public Supabase client configuration. Never place a service-role key here. */
(function (global) {
  const projectUrl = "https://ufstydudgffhbkkjtbbg.supabase.co";
  const publishableKey = String(
    global.ITC_SUPABASE_PUBLISHABLE_KEY ||
      global.localStorage?.getItem("itc_supabase_publishable_key") ||
      "",
  ).trim();
  const client = publishableKey && global.supabase
    ? global.supabase.createClient(projectUrl, publishableKey)
    : null;

  global.ITCSupabaseConfig = {
    projectUrl,
    publishableKey,
    isConfigured: Boolean(publishableKey),
    client,
  };
})(window);