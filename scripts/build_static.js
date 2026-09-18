// Publish only public assets; never publish tooling, credentials or backups.
const fs = require('fs');
const vm = require('node:vm');
const configContext = {window:{}};
vm.runInNewContext(fs.readFileSync('assets/supabase-public-config.js','utf8'), configContext);
const config = {...configContext.window.ITCSupabasePublicConfig};
config.publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || config.publishableKey || '').trim();
let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey);
if (!publicKey) {
  try {
    const claims = JSON.parse(Buffer.from(config.publishableKey.split('.')[1], 'base64url').toString());
    publicKey = claims.role === 'anon' && claims.ref === new URL(config.projectUrl).hostname.split('.')[0];
  } catch (_) {}
}
if (!publicKey) throw new Error('Clé publique Supabase absente ou invalide. Configurez SUPABASE_PUBLISHABLE_KEY dans Render ou assets/supabase-public-config.js. Une clé secrète/service_role est interdite.');
fs.mkdirSync('public', {recursive: true});
for (const file of ['index.html', 'sw.js', 'offline.html', 'privacy.html', 'manifest.webmanifest']) fs.copyFileSync(file, 'public/' + file);
fs.cpSync('assets', 'public/assets', {recursive: true});
fs.writeFileSync('public/assets/supabase-public-config.js', 'window.ITCSupabasePublicConfig = '+JSON.stringify(config)+';\n');
console.log('Public application copied to public/.');
