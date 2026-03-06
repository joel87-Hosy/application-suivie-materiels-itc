// create_firebase_user.js
// Usage:
//   1. Place your Firebase service account JSON at ./serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS to its path.
//   2. npm install
//   3. node scripts/create_firebase_user.js --email user@example.com --password Secret123! --name "GESTIONNAIRE BUREAU 02" --managedOps ITC-B02,MOOV

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const argv = yargs
  .option("email", { type: "string", demandOption: true })
  .option("password", { type: "string", demandOption: true })
  .option("name", { type: "string", demandOption: true })
  .option("managedOps", {
    type: "string",
    demandOption: true,
    description: "Comma separated list, e.g. ITC-B02,MOOV",
  })
  .option("serviceAccount", {
    type: "string",
    description: "Path to service account JSON (optional)",
  })
  .help().argv;

const serviceAccountPath =
  argv.serviceAccount ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.resolve(__dirname, "../serviceAccountKey.json");
if (!fs.existsSync(serviceAccountPath)) {
  console.error("Service account file not found:", serviceAccountPath);
  console.error(
    "Place the JSON key at ./serviceAccountKey.json or pass --serviceAccount / set GOOGLE_APPLICATION_CREDENTIALS",
  );
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = admin.database();

async function main() {
  try {
    console.log("Creating auth user:", argv.email);
    const userRecord = await admin.auth().createUser({
      email: argv.email,
      password: argv.password,
      displayName: argv.name,
      emailVerified: false,
    });

    console.log("Auth user created, uid=", userRecord.uid);

    const managedOps = argv.managedOps
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Read current itc_data/users
    const ref = db.ref("itc_data");
    const snap = await ref.once("value");
    const data = snap.val() || {};

    let users = [];
    if (Array.isArray(data.users)) users = data.users.slice();
    else if (data.users && typeof data.users === "object")
      users = Object.values(data.users);

    const maxId = users.reduce((a, u) => Math.max(a, Number(u.id) || 0), 0);
    const newId = maxId + 1;

    const newUserProfile = {
      id: newId,
      name: argv.name,
      role: "Gestionnaire",
      email: argv.email,
      managedOps: managedOps,
    };

    users.push(newUserProfile);

    // Write back users array
    await ref.child("users").set(users);
    console.log("User profile added to Realtime DB with id=", newId);

    // Ensure initial stock entries exist for managedOps
    let stock = Array.isArray(data.stock) ? data.stock.slice() : [];
    managedOps.forEach((op) => {
      // If there's no stock item for this op, add a placeholder
      const existsForOp = stock.some(
        (s) => String(s.op || "").toUpperCase() === String(op).toUpperCase(),
      );
      if (!existsForOp) {
        stock.push({
          op: op,
          label: `INVENTAIRE INITIAL ${op}`,
          qty: 0,
          type: "AUTO",
        });
      }
    });

    await ref.child("stock").set(stock);
    console.log("Stock seeded/updated for managedOps:", managedOps.join(", "));

    console.log("Done. Credentials created and DB updated.");
    console.log("Auth uid:", userRecord.uid);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message || err);
    process.exit(1);
  }
}

main();
