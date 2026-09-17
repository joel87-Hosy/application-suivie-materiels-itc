// deploy_database_rules.js
// Deploys Realtime Database rules using the Firebase Admin SDK.
// Usage:
//   npm run deploy-database-rules -- --serviceAccount tools/serviceAccountKey.json

const { initializeApp, cert, getApp, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const argv = yargs
  .option("serviceAccount", {
    type: "string",
    description: "Path to service account JSON",
  })
  .option("rules", {
    type: "string",
    default: "database.rules.json",
    description: "Path to Realtime Database rules JSON",
  })
  .option("appUrl", {
    type: "string",
    demandOption: true,
    description: "Public application URL; verifies the compatible client before restricting access",
  })
  .option("migrate", {type:"boolean", default:false, description:"Freeze client writes and migrate existing data before publishing rules"})
  .help().argv;

const serviceAccountPath = path.resolve(
  process.cwd(),
  argv.serviceAccount ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, "../serviceAccountKey.json"),
);
const rulesPath = path.resolve(process.cwd(), argv.rules);

if (!fs.existsSync(serviceAccountPath)) {
  console.error("Service account file not found:", serviceAccountPath);
  process.exit(1);
}

if (!fs.existsSync(rulesPath)) {
  console.error("Rules file not found:", rulesPath);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

async function main() {
  const database = getDatabase();
  const base = new URL(argv.appUrl.endsWith('/') ? argv.appUrl : argv.appUrl + '/');
  const normalized = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (const file of ['index.html', 'assets/secure-store.js', 'assets/profile.js', 'assets/control-core.js', 'assets/stock-control.js', 'assets/stock-control.css']) {
    const response = await fetch(new URL(file, base), {cache:'no-store', signal:AbortSignal.timeout(20000)});
    if (!response.ok || normalized(await response.text()) !== normalized(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'))) {
      throw new Error('The published application is not the current secure version: ' + file);
    }
  }
  if (argv.migrate) {
    const {migrate} = require('./migrate_tenant_security');
    // Check the data before entering maintenance, without writing anything.
    migrate((await database.ref().once('value')).val());
    const previousRules = await database.getRulesJSON();
    fs.mkdirSync('.security-backups', {recursive:true});
    const stamp = Date.now();
    fs.writeFileSync(`.security-backups/rules-${stamp}.json`, JSON.stringify(previousRules), {flag:'wx',mode:0o600});
    function freeze(node) {
      return Object.fromEntries(Object.entries(node).map(([key,value]) => [key,key === '.write' ? false : value && typeof value === 'object' && !Array.isArray(value) ? freeze(value) : value]));
    }
    await database.setRules(freeze(previousRules));
    console.log('Client writes paused for the security migration.');
    try {
      const migrationRef = database.ref();
      // Keep the snapshot cached while the transaction starts. A one-shot read
      // can be evicted, causing the first callback to receive null and abort.
      const keepCached = () => {};
      migrationRef.on('value', keepCached);
      try {
      const original = (await migrationRef.once('value')).val();
      fs.writeFileSync(`.security-backups/data-${stamp}.json`, JSON.stringify(original), {flag:'wx',mode:0o600});
      const next = migrate(original);
      const result = await migrationRef.transaction(current => JSON.stringify(current) === JSON.stringify(original) ? next : undefined, undefined, false);
      if (!result.committed) throw new Error('Concurrent administrative write; migration aborted.');
      } finally {
        migrationRef.off('value', keepCached);
      }
    } catch (error) {
      throw new Error('Migration failed; client writes remain paused. Diagnose before restoring access. ' + error.message);
    }
  }
  const schema = (await database.ref('security_schema_version').once('value')).val();
  if (schema !== 2) throw new Error('Use --migrate for the first deployment of the tenant security rules.');
  const controlSchema = (await database.ref('stock_control_schema_version').once('value')).val();
  if (controlSchema !== 1) throw new Error('Use --migrate to prepare stock indexes and controller permissions before deploying these rules.');
  await database.setRules(rules);
  const deployedRules = await database.getRulesJSON();

  if (stableStringify(deployedRules) !== stableStringify(rules)) {
    throw new Error("Rules were deployed but the read-back comparison failed.");
  }

  console.log("Realtime Database rules deployed and verified.");
  await deleteApp(getApp());
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
