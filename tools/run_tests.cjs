/* Suite exécutable partout : ni navigateur, ni émulateur, ni fichier local privé.
 * Découverte automatique — un nouveau tools/test_*.js est pris en compte sans
 * modification ici. Toute exclusion doit porter une raison. */
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const EXCLUDED={
 'test_bon_scanner_browser.cjs':'Chrome headless + .tools/report-libs (non versionné)',
 'test_admin_dependencies.js':'émulateur Realtime Database (127.0.0.1:9000)',
 'test_database_security.js':'émulateur Realtime Database (firebase emulators:exec)',
 'test_migrated_dataset.js':'émulateur Realtime Database (firebase emulators:exec)',
 'test_stock_control.js':'émulateur Realtime Database (127.0.0.1:9000)',
 'test_all_tabs_browser.cjs':'Chrome headless + instantané privé (TAB_AUDIT_FIXTURE)',
 'test_assistant_reports_browser.js':'Chrome headless + .tools/report-libs (non versionné)',
 'test_bon_reference_integration.js':'.tools/report-libs (non versionné)',
 'test_cable_offcuts_browser.js':'Chrome headless + .tools (non versionné)',
 'test_control_browser.js':'Chrome headless + .tools (non versionné)',
};
const files=fs.readdirSync('tools').filter(f=>/^test_.*\.(js|cjs)$/.test(f)).sort();
const selected=files.filter(f=>!EXCLUDED[f]);
const noisy=/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|To eliminate this warning|trace-warnings/;
const failures=[];
for(const file of selected){
 const started=Date.now();
 const run=spawnSync(process.execPath,[path.join('tools',file)],{encoding:'utf8',timeout:300000});
 const output=[run.stdout,run.stderr].join('').split('\n').filter(l=>l.trim()&&!noisy.test(l));
 const ok=run.status===0&&output.some(l=>/^(PASS|OK)\b/.test(l));
 process.stdout.write(`${ok?'ok  ':'FAIL'}  ${file.padEnd(38)} ${((Date.now()-started)/1000).toFixed(1)}s\n`);
 if(!ok){failures.push(file);output.slice(-15).forEach(l=>process.stdout.write('        '+l+'\n'));}
}
for(const [file,reason] of Object.entries(EXCLUDED)) if(files.includes(file)) process.stdout.write(`skip  ${file.padEnd(38)} ${reason}\n`);
const orphans=Object.keys(EXCLUDED).filter(f=>!files.includes(f));
if(orphans.length) process.stdout.write('\nExclusions obsolètes à retirer de run_tests.cjs : '+orphans.join(', ')+'\n');
process.stdout.write(`\n${selected.length-failures.length}/${selected.length} tests passés.\n`);
if(failures.length){process.stdout.write('Échecs : '+failures.join(', ')+'\n');process.exitCode=1;}
