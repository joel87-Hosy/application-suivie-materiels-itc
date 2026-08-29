// check_security_profiles.js
// Checks that every app user has an auth UID and matching auth_profiles entry.
// Usage:
//   npm run check-security-profiles -- --serviceAccount tools/serviceAccountKey.json

const admin = require("firebase-admin");
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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = admin.database();

function toList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

async function main() {
  const [usersSnap, profilesSnap] = await Promise.all([
    db.ref("itc_data/users").once("value"),
    db.ref("auth_profiles").once("value"),
  ]);
  const users = toList(usersSnap.val());
  const profiles = profilesSnap.val() || {};
  const issues = [];

  for (const user of users) {
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email) {
      issues.push("Profil sans email dans itc_data/users");
      continue;
    }

    let authUser = null;
    try {
      authUser = await admin.auth().getUserByEmail(email);
    } catch (error) {
      issues.push(`${email}: absent de Firebase Auth`);
      continue;
    }

    const profile = profiles[authUser.uid];
    if (!profile) {
      issues.push(`${email}: auth_profiles/${authUser.uid} absent`);
      continue;
    }

    if (profile.is_active !== true) {
      issues.push(`${email}: auth_profiles is_active n'est pas true`);
    }
    if (String(profile.role || "") !== String(user.role || "")) {
      issues.push(`${email}: role different (${profile.role || "-"} / ${user.role || "-"})`);
    }
    if (String(profile.company_id || "") !== String(user.company_id || "")) {
      issues.push(
        `${email}: company_id different (${profile.company_id || "-"} / ${user.company_id || "-"})`,
      );
    }
  }

  if (issues.length) {
    console.log("Security profile issues found:");
    issues.forEach((issue) => console.log(`- ${issue}`));
    process.exitCode = 1;
  } else {
    console.log(`Security profiles OK: ${users.length} app user(s) checked.`);
  }

  await admin.app().delete();
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
