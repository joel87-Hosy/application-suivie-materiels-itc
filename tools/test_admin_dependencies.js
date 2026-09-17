// Requires the local Realtime Database emulator on 127.0.0.1:9000.
const assert = require('node:assert/strict');
const {generateKeyPairSync} = require('node:crypto');
const http = require('node:http');
const {initializeApp, cert, deleteApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getDatabase} = require('firebase-admin/database');

async function main() {
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048, privateKeyEncoding:{type:'pkcs8',format:'pem'}, publicKeyEncoding:{type:'spki',format:'pem'}});
  const app = initializeApp({projectId:'demo-admin-dependencies', databaseURL:'https://demo-admin-dependencies.firebaseio.com', credential:cert({projectId:'demo-admin-dependencies',clientEmail:'test@demo-admin-dependencies.iam.gserviceaccount.com',privateKey})});
  try {
    const token = await getAuth(app).createCustomToken('test-user', {role:'Gestionnaire'});
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    assert.equal(payload.uid, 'test-user');
    assert.equal(payload.claims.role, 'Gestionnaire');
    const ref = getDatabase(app).ref('dependency-smoke');
    await ref.set({qty:2});
    await ref.update({qty:3});
    assert.equal((await ref.get()).val().qty, 3);
    await ref.remove();
  } finally { await deleteApp(app); }

  // gaxios 6 uses uuid.v4 for multipart boundaries; verify the scoped override.
  let body = '', contentType = '';
  const server = http.createServer((req,res) => {
    contentType = req.headers['content-type'];
    req.on('data', chunk => {body += chunk;});
    req.on('end', () => {res.end('ok');});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const {request} = require('gaxios');
    await request({url:`http://127.0.0.1:${server.address().port}`,method:'POST',proxy:false,multipart:[{headers:{'Content-Type':'text/plain'},content:'dependency-check'}]});
    assert.match(contentType, /multipart\/related; boundary=[a-f0-9-]{36}/);
    assert.ok(body.includes('dependency-check'));
  } finally {await new Promise(resolve => server.close(resolve));}
  console.log('PASS: Admin SDK token signing, emulator reads/writes, cleanup and gaxios multipart compatibility.');
}
main().catch(error => {console.error(error);process.exitCode=1;});
