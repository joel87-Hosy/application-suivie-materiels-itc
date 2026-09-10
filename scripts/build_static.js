// Publish only public assets; never publish tooling, credentials or backups.
const fs = require('fs');
fs.mkdirSync('public', {recursive: true});
for (const file of ['index.html', 'sw.js', 'offline.html', 'privacy.html', 'manifest.webmanifest']) fs.copyFileSync(file, 'public/' + file);
fs.cpSync('assets', 'public/assets', {recursive: true});
console.log('Public application copied to public/.');
