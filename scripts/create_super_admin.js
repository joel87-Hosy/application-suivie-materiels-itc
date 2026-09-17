// create_super_admin.js
// Usage:
//   node scripts/create_super_admin.js --password "ChangeMe123!"
//   node scripts/create_super_admin.js --email admin@system.local --password "ChangeMe123!" --name "SUPER ADMIN"

const { initializeApp, cert, getApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const argv = yargs
  .option("email", {
    type: "string",
    default: "admin@system.local",
    description: "Super admin email",
  })
  .option("password", {
    type: "string",
    demandOption: true,
    description: "Temporary password for the super admin account",
  })
  .option("name", {
    type: "string",
    default: "SUPER ADMIN",
    description: "Display name",
  })
  .option("serviceAccount", {
    type: "string",
    description: "Path to service account JSON",
  })
  .help().argv;

const serviceAccountPath =
  path.resolve(
    process.cwd(),
    argv.serviceAccount ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.resolve(__dirname, "../serviceAccountKey.json"),
  );

if (!fs.existsSync(serviceAccountPath)) {
  console.error("Service account file not found:", serviceAccountPath);
  console.error(
    "Place the JSON key at ./serviceAccountKey.json, pass --serviceAccount, or set GOOGLE_APPLICATION_CREDENTIALS.",
  );
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = getDatabase();

async function getOrCreateAuthUser() {
  const email = String(argv.email || "").trim().toLowerCase();
  try {
    const existing = await getAuth().getUserByEmail(email);
    await getAuth().updateUser(existing.uid, {
      password: argv.password,
      displayName: argv.name,
      disabled: false,
    });
    return existing.uid;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    const created = await getAuth().createUser({
      email,
      password: argv.password,
      displayName: argv.name,
      emailVerified: false,
      disabled: false,
    });
    return created.uid;
  }
}

async function main() {
  const email = String(argv.email || "").trim().toLowerCase();
  const uid = await getOrCreateAuthUser();

  await getAuth().setCustomUserClaims(uid, {
    role: "SUPER_ADMIN",
    company_id: "PLATFORM",
  });
  await db.ref(`auth_profiles/${uid}`).set({
    uid,
    email,
    role: "SUPER_ADMIN",
    company_id: "PLATFORM",
    is_active: true,
    updated_at: new Date().toISOString(),
  });

  const ref = db.ref("itc_data");
  const snap = await ref.once("value");
  const data = snap.val() || {};
  const users = Array.isArray(data.users)
    ? data.users.slice()
    : data.users && typeof data.users === "object"
      ? Object.values(data.users)
      : [];

  const existingIndex = users.findIndex(
    (u) => String(u?.email || "").toLowerCase() === email,
  );
  const maxId = users.reduce((max, u) => Math.max(max, Number(u?.id) || 0), 0);
  const profile = {
    ...(existingIndex >= 0 ? users[existingIndex] : {}),
    id: existingIndex >= 0 ? users[existingIndex].id || maxId + 1 : maxId + 1,
    uid,
    company_id: "PLATFORM",
    name: argv.name,
    full_name: argv.name,
    role: "SUPER_ADMIN",
    email,
    is_active: true,
    created_at:
      existingIndex >= 0
        ? users[existingIndex].created_at || new Date().toISOString()
        : new Date().toISOString(),
  };

  const key = existingIndex >= 0 ? Object.keys(data.users)[existingIndex] : ref.child("users").push().key;
  await ref.child("users/" + key).set(profile);
  await db.ref("auth_profiles/" + uid + "/user_id").set(profile.id);

  console.log("Super admin ready.");
  console.log("Email:", email);
  console.log("Role: SUPER_ADMIN");
  console.log("Auth uid:", uid);
  console.log("Temporary password was set from --password.");
  await deleteApp(getApp());
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
