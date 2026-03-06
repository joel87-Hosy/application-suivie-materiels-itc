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
    describe: "Firebase Realtime Database URL",
  })
  .option("dryRun", {
    type: "boolean",
    default: true,
    describe: "Show changes without writing",
  }).argv;

function loadServiceAccount(path) {
  try {
    return require(path);
  } catch (e) {
    console.error("Cannot load service account:", path, e.message);
    process.exit(1);
  }
}

function mergeStats(target, source) {
  if (!source) return target;
  target.availableTotal =
    (parseInt(target.availableTotal) || 0) +
    (parseInt(source.availableTotal) || 0);
  target.entrantsByDesignation = target.entrantsByDesignation || {};
  target.sortantsByDesignation = target.sortantsByDesignation || {};

  Object.entries(source.entrantsByDesignation || {}).forEach(([k, v]) => {
    target.entrantsByDesignation[k] =
      (target.entrantsByDesignation[k] || 0) + (parseInt(v) || 0);
  });
  Object.entries(source.sortantsByDesignation || {}).forEach(([k, v]) => {
    target.sortantsByDesignation[k] =
      (target.sortantsByDesignation[k] || 0) + (parseInt(v) || 0);
  });
  return target;
}

async function run() {
  const serviceAccount = loadServiceAccount(argv.serviceAccount);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: argv.databaseURL,
  });
  const db = admin.database();
  const ref = db.ref("itc_data/consumptionArchives");

  console.log("Lecture des archives depuis itc_data/consumptionArchives");
  const snap = await ref.once("value");
  const archives = snap.val() || [];
  if (!Array.isArray(archives)) {
    console.error(
      "La structure itc_data/consumptionArchives n'est pas un tableau. Abandon.",
    );
    process.exit(1);
  }

  let changedCount = 0;
  const changes = [];

  const updated = archives.map((archive, idx) => {
    const a = { ...archive };
    // determine february: prefer key like 'YYYY-02' or monthIndex === 1
    const key = String(a.key || "");
    const monthIndex = typeof a.monthIndex === "number" ? a.monthIndex : null;
    const isFeb = key.endsWith("-02") || monthIndex === 1;
    if (!isFeb) return a;

    const opStats =
      a.operatorStats && typeof a.operatorStats === "object"
        ? { ...a.operatorStats }
        : {};
    if (opStats["ITC"]) {
      const itcStats = opStats["ITC"];
      const targetKey = "ITC-B01";
      const existingTarget = opStats[targetKey] || {
        availableTotal: 0,
        entrantsByDesignation: {},
        sortantsByDesignation: {},
      };
      const merged = mergeStats(existingTarget, itcStats);
      opStats[targetKey] = merged;
      delete opStats["ITC"];
      a.operatorStats = opStats;
      changedCount++;
      changes.push({
        index: idx,
        key: a.key || "",
        note: `ITC -> ${targetKey}`,
      });
    }
    return a;
  });

  console.log(
    `Archives trouvées: ${archives.length}. Archives février modifiables: ${changedCount}`,
  );
  if (changedCount > 0) {
    changes.forEach((c) => console.log(" -", c.index, c.key, c.note));
  }

  if (changedCount === 0) {
    console.log("Aucune modification nécessaire.");
    process.exit(0);
  }

  if (argv.dryRun) {
    console.log(
      "Dry run activé — aucune écriture effectuée. Relancer avec --dryRun=false pour appliquer.",
    );
    process.exit(0);
  }

  // Apply updates
  console.log("Écriture des archives mises à jour dans la base...");
  await ref.set(updated);
  console.log("Mise à jour terminée.");
  process.exit(0);
}

run().catch((e) => {
  console.error("Erreur:", e && e.stack ? e.stack : e);
  process.exit(1);
});
