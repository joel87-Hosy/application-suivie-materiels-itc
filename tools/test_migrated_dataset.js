// Read-only production audit. All writes below go to the local emulator.
const fs = require('fs');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const {initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {migrate} = require('../scripts/migrate_tenant_security');
const {SecureStore} = require('../assets/secure-store');
async function main() {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error('Run inside firebase emulators:exec.');
  // Use REST for the production read so the Admin SDK emulator env cannot redirect it.
  const credential = admin.credential.cert(require('../tools/serviceAccountKey.json'));
  const token = await credential.getAccessToken();
  const response = await fetch('https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app/.json', {headers:{Authorization:'Bearer '+token.access_token}});
  if (!response.ok) throw new Error('Production read failed: ' + response.status);
  const data = migrate(await response.json());
  const env = await initializeTestEnvironment({projectId:'demo-itc-security', database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.json','utf8')}});
  try {
    await env.withSecurityRulesDisabled(c => c.database().ref().set(data));
    let checked=0;
    for (const profile of Object.values(data.auth_profiles)) {
      if (!profile.is_active) continue;
      const store=new SecureStore(env.authenticatedContext(profile.uid).database(),()=>{},error=>{throw error;});
      try {
        await store.connect({uid:profile.uid});
        const loaded=store.value();
        if (profile.role !== 'SUPER_ADMIN') for (const name of ['stock','users','sorties','demandes']) assert.ok(loaded[name].every(row=>row.company_id===profile.company_id));
        await store.save(loaded);
        checked++;
      } finally {store.stop();}
    }
    console.log('PASS: migrated production dataset loaded and unchanged saves accepted for ' + checked + ' active profiles; no production writes.');
  } finally {await env.cleanup();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
