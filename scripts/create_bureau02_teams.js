// Creates the requested team accounts; existing accounts are never reset.
const { initializeApp, cert, getApp, getApps, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const names = ['Flash-Abonné', 'Les Express', 'Équipe Top-Chrono', 'Swift-Tech', 'Alpha-Client', 'Unité Signal', 'Team PTO', 'Lien-Direct', 'Escadron Dernier-Mètre'];
const usernameFor = name => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function main() {
  initializeApp({
    credential: cert(require(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tools/serviceAccountKey.json'))),
    databaseURL: 'https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app',
  });
  const db = getDatabase();
  const users = (await db.ref('itc_data/users').once('value')).val() || {};
  const profiles = Object.values(users).filter(Boolean);
  if (!profiles.some(u => u.company_id === 'COMP-ITC-LEGACY' && (u.managedOps || []).includes('ITC-B02'))) throw new Error('Bureau 02 introuvable');
  let nextId = Math.max(0, ...profiles.map(u => Number(u.id) || 0)) + 1;
  let nextKey = Math.max(-1, ...Object.keys(users).filter(k => /^\d+$/.test(k)).map(Number)) + 1;
  const output = path.resolve('tools/comptes-bureau-02.json');
  const credentials = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : [];
  for (const name of names) {
    const username = usernameFor(name);
    const email = username + '@techniciens.itc.invalid';
    const existing = profiles.find(u => u.email === email || u.username === username);
    if (existing) {
      if (existing.company_id !== 'COMP-ITC-LEGACY' || existing.role !== 'Technicien' || !(existing.managedOps || []).includes('ITC-B02')) throw new Error('Compte incompatible : ' + username);
      console.log('Existe : ' + username);
      continue;
    }
    const password = crypto.randomBytes(15).toString('base64url') + '!7a';
    const user = await getAuth().createUser({email, password, displayName: name});
    // Save immediately so a later database failure cannot lose the password.
    credentials.push({equipe: name, username, password, bureau: '02'});
    fs.writeFileSync(output, JSON.stringify(credentials, null, 2) + '\n', {mode: 0o600});
    const security = {uid: user.uid, email, role: 'Technicien', company_id: 'COMP-ITC-LEGACY', is_active: true};
    await getAuth().setCustomUserClaims(user.uid, {role: security.role, company_id: security.company_id});
    await db.ref().update({
      ['auth_profiles/' + user.uid]: security,
      ['itc_data/users/' + nextKey++]: {...security, id: nextId++, name, full_name: name, username, managedOps: ['ITC-B02', 'MOOV'], temporary_password: null, must_change_password: true, account_status: 'active', created_at: new Date().toISOString()},
    });
    const saved = (await db.ref('auth_profiles/' + user.uid).once('value')).val();
    if (!saved || saved.company_id !== security.company_id) throw new Error('Vérification échouée : ' + username);
    console.log('Créé et vérifié : ' + username);
  }
  console.log('Identifiants enregistrés dans tools/comptes-bureau-02.json');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;}).finally(async () => {if (getApps().length) await deleteApp(getApp());});
