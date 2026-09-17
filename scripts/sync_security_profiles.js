// sync_security_profiles.js
// Backfills auth_profiles/$uid from existing itc_data/users profiles.
// Usage:
//   npm run sync-security-profiles -- --serviceAccount tools/serviceAccountKey.json

const { initializeApp, cert, getApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const argv = yargs
  .option("serviceAccount", {
    type: "string",
    description: "Path to service account JSON",
  })
  .help().argv;

const serviceAccountPath = path.resolve(
  process.cwd(),
  argv.serviceAccount ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, "../serviceAccountKey.json"),
);

if (!fs.existsSync(serviceAccountPath)) {
  console.error("Service account file not found:", serviceAccountPath);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = getDatabase();

function toList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

async function resolveUid(profile) {
  if (profile.uid) return profile.uid;
  const email = String(profile.email || "").trim().toLowerCase();
  if (!email) return null;
  try {
    const userRecord = await getAuth().getUserByEmail(email);
    return userRecord.uid;
  } catch (error) {
    console.warn("Auth user not found for profile:", email);
    return null;
  }
}

async function main() {
  const snap = await db.ref("itc_data/users").once("value");
  const users = toList(snap.val());
  let synced = 0;
  let skipped = 0;

  for (const profile of users) {
    const uid = await resolveUid(profile || {});
    if (!uid) {
      skipped += 1;
      continue;
    }
    const email = String(profile.email || "").trim().toLowerCase();
    const role = String(profile.role || "").trim();
    const existing = (await db.ref(`auth_profiles/${uid}`).once('value')).val();
    if (existing) {
      // Never reactivate or promote an existing account from a business copy.
      skipped += 1;
      continue;
    }
    const companyId = profile.company_id || (role === 'SUPER_ADMIN' ? 'PLATFORM' : 'COMP-ITC-LEGACY');
    await db.ref(`auth_profiles/${uid}`).set({
      uid,
      email,
      role,
      company_id: companyId,
      user_id: profile.id,
      controlScopes: require('../assets/control-core').scopeMap(profile.managedOps),
      controlScopeKeys: require('../assets/control-core').scopeKeys(companyId, profile.managedOps),
      is_active: profile.is_active !== false,
      is_demo: profile.is_demo === true,
      updated_at: new Date().toISOString(),
    });
    await getAuth().setCustomUserClaims(uid, {
      role,
      company_id: companyId,
    });
    synced += 1;
  }

  console.log("Security profiles synced:", synced);
  console.log("Profiles skipped:", skipped);
  await deleteApp(getApp());
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
