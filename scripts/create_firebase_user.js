// create_firebase_user.js
// Usage:
//   1. Place your Firebase service account JSON at ./serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS to its path.
//   2. npm install
//   3. node scripts/create_firebase_user.js --email user@example.com --password Secret123! --name "GESTIONNAIRE BUREAU 02" --role Gestionnaire --companyId COMP-... --managedOps ITC-B02,MOOV

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const argv = yargs
  .option("email", { type: "string", demandOption: true })
  .option("password", { type: "string", demandOption: true })
  .option("name", { type: "string", demandOption: true })
  .option("role", {
    type: "string",
    default: "Gestionnaire",
    choices: ["Contrôleur", "Superviseur", "Superviseur Terrain", "Gestionnaire", "Coordinatrice", "Coordinateur", "Technicien"],
  })
  .option("companyId", {
    type: "string",
    description: "Company id for tenant users, e.g. COMP-123456",
  })
  .option("managedOps", {
    type: "string",
    default: "",
    description: "Comma separated list, e.g. ITC-B02,MOOV",
  })
  .option("serviceAccount", {
    type: "string",
    description: "Path to service account JSON (optional)",
  })
  .help().argv;

const requestedScopes = argv.role === 'Contrôleur' ? [] : require('../assets/control-core').scopes(argv.managedOps);

const serviceAccountPath = path.resolve(
  process.cwd(),
  argv.serviceAccount ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, "../serviceAccountKey.json"),
);
if (!fs.existsSync(serviceAccountPath)) {
  console.error("Service account file not found:", serviceAccountPath);
  console.error(
    "Place the JSON key at ./serviceAccountKey.json or pass --serviceAccount / set GOOGLE_APPLICATION_CREDENTIALS",
  );
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = getDatabase();

async function main() {
  try {
    const email = String(argv.email || "").trim().toLowerCase();
    console.log("Creating/updating auth user:", email);
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
      userRecord = await getAuth().updateUser(userRecord.uid, {
        password: argv.password,
        displayName: argv.name,
        disabled: false,
      });
      console.log("Auth user updated, uid=", userRecord.uid);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
      userRecord = await getAuth().createUser({
        email,
        password: argv.password,
        displayName: argv.name,
        emailVerified: false,
        disabled: false,
      });
      console.log("Auth user created, uid=", userRecord.uid);
    }

    const managedOps = requestedScopes;

    // Read current itc_data/users
    const ref = db.ref("itc_data");
    const snap = await ref.once("value");
    const data = snap.val() || {};

    let users = [];
    let userKeys = [];
    if (Array.isArray(data.users)) {
      users = data.users.slice();
      userKeys = users.map((_, index) => String(index));
    } else if (data.users && typeof data.users === "object") {
      userKeys = Object.keys(data.users);
      users = userKeys.map((key) => data.users[key]);
    }

    const maxId = users.reduce((a, u) => Math.max(a, Number(u.id) || 0), 0);
    const existingIndex = users.findIndex(
      (u) => String(u.email || "").toLowerCase() === email,
    );

    const newUserProfile = {
      ...(existingIndex >= 0 ? users[existingIndex] : {}),
      id: existingIndex >= 0 ? users[existingIndex].id || maxId + 1 : maxId + 1,
      uid: userRecord.uid,
      company_id: argv.companyId || users[existingIndex]?.company_id || 'COMP-ITC-LEGACY',
      name: argv.name,
      full_name: argv.name,
      role: argv.role,
      email,
      managedOps: managedOps,
      temporary_password: null,
      is_active: true,
      created_at:
        existingIndex >= 0
          ? users[existingIndex].created_at || new Date().toISOString()
          : new Date().toISOString(),
    };

    await getAuth().setCustomUserClaims(userRecord.uid, {
      role: argv.role,
      company_id: newUserProfile.company_id,
    });
    await db.ref(`auth_profiles/${userRecord.uid}`).set({
      uid: userRecord.uid,
      email,
      role: argv.role,
      company_id: newUserProfile.company_id,
      is_active: true,
      updated_at: new Date().toISOString(),
      user_id: newUserProfile.id,
      controlScopes: require('../assets/control-core').scopeMap(managedOps),
      controlScopeKeys: require('../assets/control-core').scopeKeys(newUserProfile.company_id, managedOps),
    });

    // Write only the touched profile to avoid overwriting concurrent changes.
    const profileKey =
      existingIndex >= 0 ? userKeys[existingIndex] : ref.child('users').push().key;
    await ref.child(`users/${profileKey}`).set(newUserProfile);
    console.log("User profile saved to Realtime DB with id=", newUserProfile.id);

    // Ensure initial stock entries exist for managedOps without rewriting stock.
    const stock = Array.isArray(data.stock)
      ? data.stock.slice()
      : data.stock && typeof data.stock === "object"
        ? Object.values(data.stock)
        : [];
    for (const op of argv.role === 'Contrôleur' ? [] : managedOps) {
      const existsForOp = stock.some(
        (s) => s.company_id === newUserProfile.company_id && String(s.op || "").toUpperCase() === String(op).toUpperCase(),
      );
      if (!existsForOp) {
        await ref.child('stock').push().set({
          company_id: newUserProfile.company_id,
          op: op,
          scope_key: require('../assets/control-core').scopeKey(newUserProfile.company_id, op),
          label: `INVENTAIRE INITIAL ${op}`,
          qty: 0,
          type: "AUTO",
        });
      }
    }

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
