// Dry run by default. No roles are inferred from editable business profiles.
const fs = require('fs');
const path = require('path');
const {collections, settings} = require('../assets/secure-store');
const LEGACY = 'COMP-ITC-LEGACY';
function migrate(root) {
  const result = JSON.parse(JSON.stringify(root));
  const data = result.itc_data || {};
  const profiles = result.auth_profiles || {};
  const users = Object.values(data.users || {}).filter(Boolean);
  const byId = new Map(users.map(u => [String(u.id), u]));
  const companyIds = new Set([LEGACY, 'PLATFORM']);
  for (const c of Object.values(data.companies || {}).filter(Boolean)) companyIds.add(c.id);
  for (const [uid, p] of Object.entries(profiles)) {
    p.company_id ||= p.role === 'SUPER_ADMIN' ? 'PLATFORM' : LEGACY;
    if (!companyIds.has(p.company_id)) throw new Error('Unknown security company for profile ' + uid);
    const user = users.find(u => u.uid === uid);
    if (!user) { p.is_active = false; continue; }
    if (p.role !== user.role || (user.company_id && p.company_id !== user.company_id)) throw new Error('Security profile mismatch: ' + uid);
    p.is_active = p.is_active === true && user.is_active !== false && !['suspended', 'disabled'].includes(user.account_status);
    p.user_id = user.id;
    user.is_active = p.is_active;
    user.company_id = p.company_id;
  }
  for (const name of collections) for (const row of Object.values(data[name] || {}).filter(Boolean)) {
    if (typeof row !== 'object' || Array.isArray(row)) throw new Error('Unexpected record: ' + name);
    if (name === 'companies') row.company_id = row.id;
    else if (!row.company_id) {
      const owner = byId.get(String(row.demandeurOriginalId ?? row.userId ?? row.demandeurId ?? row.technicienId));
      row.company_id = owner?.company_id || LEGACY;
    }
    if (!companyIds.has(row.company_id)) throw new Error('Unknown company in ' + name);
    if (name === 'users' && !profiles[row.uid]) row.is_active = false;
    delete row.temporary_password;
  }
  result.tenant_branding ||= {};
  result.tenant_settings ||= {};
  for (const companyId of companyIds) {
    const company = Object.values(data.companies || {}).find(c => c?.id === companyId);
    result.tenant_branding[companyId] = {
      id: companyId, name: company?.name || (companyId === LEGACY ? 'ITC' : 'Plateforme'),
      logo_url: company?.logo_url || 'assets/saas-logo.svg', status: company?.status || 'active',
    };
    result.tenant_settings[companyId] ||= {};
    for (const key of settings) {
      if (result.tenant_settings[companyId][key] === undefined && data[key] !== undefined && (companyId === LEGACY || key === 'materialTypes')) result.tenant_settings[companyId][key] = data[key];
    }
  }
  // Legacy scalar paths become inaccessible under the new rules.
  result.security_schema_version = 2;
  return result;
}
async function main() {
  const admin = require('firebase-admin');
  const argv = require('yargs/yargs')(process.argv.slice(2)).option('apply', {type:'boolean',default:false}).option('serviceAccount', {type:'string',default:'tools/serviceAccountKey.json'}).parse();
  admin.initializeApp({credential:admin.credential.cert(require(path.resolve(argv.serviceAccount))),databaseURL:'https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app'});
  try {
    const ref = admin.database().ref();
    const original = (await ref.once('value')).val();
    const next = migrate(original);
    const count = name => Object.values(next.itc_data[name] || {}).filter(Boolean).length;
    console.log(JSON.stringify({mode:argv.apply?'apply':'dry-run',records:Object.fromEntries(collections.map(name => [name,count(name)])),profiles:Object.keys(next.auth_profiles).length}));
    if (!argv.apply) return;
    const liveRules = await admin.database().getRulesJSON();
    const permitsWrites = node => Object.entries(node).some(([key,value]) => key === '.write' ? value !== false : value && typeof value === 'object' && !Array.isArray(value) && permitsWrites(value));
    if (permitsWrites(liveRules)) throw new Error('Client writes must be paused first. Prefer deploy-database-rules --migrate --appUrl <url>.');
    fs.mkdirSync('.security-backups', {recursive:true});
    fs.writeFileSync('.security-backups/before-tenant-security-' + Date.now() + '.json', JSON.stringify(original), {mode:0o600,flag:'wx'});
    const fingerprint = JSON.stringify(original);
    const transaction = await ref.transaction(current => {
      if (JSON.stringify(current) !== fingerprint) return; // Never overwrite concurrent production writes.
      return next;
    }, undefined, false);
    if (!transaction.committed) throw new Error('Data changed during migration. No migration applied; retry during maintenance.');
    console.log('Migration committed atomically; backup saved outside public/.');
  } finally { await admin.app().delete(); }
}
if (require.main === module) main().catch(e => {console.error(e.message);process.exitCode=1;});
module.exports = {migrate};
