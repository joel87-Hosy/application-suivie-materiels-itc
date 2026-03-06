#!/usr/bin/env node
const admin = require("firebase-admin");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .option("serviceAccount", {
    type: "string",
    demandOption: true,
    describe: "Path to service account JSON",
  })
  .option("databaseURL", {
    type: "string",
    demandOption: true,
    describe: "Firebase Realtime Database URL (https://... )",
  })
  .option("dryRun", {
    type: "boolean",
    default: true,
    describe: "Only show changes without writing",
  }).argv;

function loadServiceAccount(path) {
  try {
    return require(path);
  } catch (e) {
    console.error("Impossible de lire le fichier de compte de service:", path);
    console.error(e.message);
    process.exit(1);
  }
}

async function run() {
  const serviceAccount = loadServiceAccount(argv.serviceAccount);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: argv.databaseURL,
  });

  const db = admin.database();
  const stockRef = db.ref("itc_data/stock");

  console.log("Lecture du stock depuis:", "itc_data/stock");
  const snap = await stockRef.once("value");
  const stock = snap.val() || {};

  const updates = {};
  let changed = 0;
  for (const key of Object.keys(stock)) {
    const item = stock[key];
    if (!item || !item.op) continue;
    const op = String(item.op || "").toUpperCase();
    if (op === "ITC") {
      const newOp = "ITC-B01";
      updates[`${key}/op`] = newOp;
      console.log(`Will update ${key}: op ${op} -> ${newOp}`);
      changed++;
    }
  }

  if (changed === 0) {
    console.log(
      "Aucune entrée 'ITC' trouvée dans itc_data/stock. Rien à faire.",
    );
    process.exit(0);
  }

  console.log(`Found ${changed} items to update.`);
  if (argv.dryRun) {
    console.log(
      "Dry run enabled — no changes will be written. Rerun with --dryRun=false to apply.",
    );
    process.exit(0);
  }

  console.log("Applying updates...");
  await stockRef.update(updates);
  console.log("Mise à jour terminée.");
  process.exit(0);
}

run().catch((e) => {
  console.error("Erreur:", e.message);
  process.exit(1);
});
