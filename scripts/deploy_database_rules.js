// deploy_database_rules.js
// Deploys Realtime Database rules using the Firebase Admin SDK.
// Usage:
//   npm run deploy-database-rules -- --serviceAccount tools/serviceAccountKey.json

const admin = require("firebase-admin");
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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

async function main() {
  const database = admin.database();
  await database.setRules(rules);
  const deployedRules = await database.getRulesJSON();

  if (stableStringify(deployedRules) !== stableStringify(rules)) {
    throw new Error("Rules were deployed but the read-back comparison failed.");
  }

  console.log("Realtime Database rules deployed and verified.");
  await admin.app().delete();
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
