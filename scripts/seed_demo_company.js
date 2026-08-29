// seed_demo_company.js
// Creates or updates a demo SaaS tenant with internal role accounts.
// Usage:
//   npm run seed-demo-company -- --serviceAccount tools/serviceAccountKey.json

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const argv = yargs
  .option("serviceAccount", {
    type: "string",
    description: "Path to service account JSON",
  })
  .option("companyId", {
    type: "string",
    default: "COMP-DEMO-CLIENT",
  })
  .option("password", {
    type: "string",
    default: "Demo-Client!26",
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

const company = {
  id: argv.companyId,
  name: "Entreprise Cliente Demo",
  email: "contact@demo-client.ci",
  phone: "+225 00 00 00 00 00",
  plan_type: "enterprise",
  max_users: 100,
  max_stores: 20,
  monthly_amount: 150000,
  payment_status: "paid",
  next_due_date: "2026-09-28",
  last_payment_amount: 150000,
  last_payment_at: new Date().toISOString(),
  status: "active",
  logo_url: "assets/saas-logo.svg",
  is_demo: true,
  created_at: new Date().toISOString(),
  created_by: "super_admin",
};

const demoAccounts = [
  {
    name: "Demo Directeur Client",
    email: "demo.superviseur@demo-client.ci",
    role: "Superviseur",
    managedOps: [],
  },
  {
    name: "Demo Superviseur Terrain",
    email: "demo.superviseur-terrain@demo-client.ci",
    role: "Superviseur Terrain",
    managedOps: ["DEMO-B01", "DEMO-B02", "DEMO-MOOV"],
  },
  {
    name: "Demo Coordinateur",
    email: "demo.coordinateur@demo-client.ci",
    role: "Coordinateur",
    managedOps: ["DEMO-B01", "DEMO-B02"],
  },
  {
    name: "Demo Coordinatrice",
    email: "demo.coordinatrice@demo-client.ci",
    role: "Coordinatrice",
    managedOps: ["DEMO-B01"],
  },
  {
    name: "Demo Gestionnaire Stock",
    email: "demo.gestionnaire@demo-client.ci",
    role: "Gestionnaire",
    managedOps: ["DEMO-B01", "DEMO-B02", "DEMO-MOOV"],
  },
  {
    name: "Demo Technicien Bureau 01",
    email: "demo.tech-b01@demo-client.ci",
    role: "Technicien",
    managedOps: ["DEMO-B01"],
  },
  {
    name: "Demo Technicien Bureau 02",
    email: "demo.tech-b02@demo-client.ci",
    role: "Technicien",
    managedOps: ["DEMO-B02"],
  },
];

const demoStock = [
  { op: "DEMO-B01", label: "Cable fibre optique 100m", qty: 25, type: "CABLE" },
  { op: "DEMO-B01", label: "Routeur client standard", qty: 12, type: "EQUIPEMENT" },
  { op: "DEMO-B01", label: "Connecteur SC/APC", qty: 180, type: "CONNECTIQUE" },
  { op: "DEMO-B02", label: "Boitier PTO", qty: 40, type: "ACCESSOIRE" },
  { op: "DEMO-B02", label: "Jarretiere optique 3m", qty: 90, type: "CABLE" },
  { op: "DEMO-MOOV", label: "Kit installation client", qty: 18, type: "KIT" },
];

function toListWithKeys(value) {
  if (Array.isArray(value)) {
    return {
      keys: value.map((_, index) => String(index)),
      list: value.slice(),
    };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return {
      keys,
      list: keys.map((key) => value[key]),
    };
  }
  return { keys: [], list: [] };
}

async function upsertCompany(ref, data) {
  const { keys, list } = toListWithKeys(data.companies);
  const existingIndex = list.findIndex((item) => item?.id === company.id);
  const key = existingIndex >= 0 ? keys[existingIndex] : String(list.length);
  await ref.child(`companies/${key}`).set({
    ...(existingIndex >= 0 ? list[existingIndex] : {}),
    ...company,
    updated_at: new Date().toISOString(),
  });
}

async function upsertAuthUser(account, password) {
  const email = account.email.toLowerCase();
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
    userRecord = await admin.auth().updateUser(userRecord.uid, {
      password,
      displayName: account.name,
      disabled: false,
    });
    console.log("Auth user updated:", email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: account.name,
      emailVerified: false,
      disabled: false,
    });
    console.log("Auth user created:", email);
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, {
    role: account.role,
    company_id: company.id,
  });
  await db.ref(`auth_profiles/${userRecord.uid}`).set({
    uid: userRecord.uid,
    email,
    role: account.role,
    company_id: company.id,
    is_active: true,
    is_demo: true,
    updated_at: new Date().toISOString(),
  });

  return userRecord;
}

async function upsertUserProfiles(ref, data, password) {
  const { keys, list } = toListWithKeys(data.users);
  let maxId = list.reduce((max, user) => Math.max(max, Number(user?.id) || 0), 0);

  for (const account of demoAccounts) {
    const authUser = await upsertAuthUser(account, password);
    const email = account.email.toLowerCase();
    const existingIndex = list.findIndex(
      (user) => String(user?.email || "").toLowerCase() === email,
    );
    const previous = existingIndex >= 0 ? list[existingIndex] : {};
    const profile = {
      ...previous,
      id: existingIndex >= 0 ? previous.id || maxId + 1 : ++maxId,
      uid: authUser.uid,
      company_id: company.id,
      company_name: company.name,
      company_logo_url: company.logo_url,
      role: account.role,
      name: account.name,
      full_name: account.name,
      email,
      managedOps: account.managedOps,
      temporary_password: password,
      must_change_password: false,
      is_active: true,
      is_demo: true,
      created_at: previous.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: "super_admin",
    };
    const key = existingIndex >= 0 ? keys[existingIndex] : String(list.length);
    await ref.child(`users/${key}`).set(profile);
    if (existingIndex >= 0) {
      list[existingIndex] = profile;
    } else {
      keys.push(key);
      list.push(profile);
    }
  }
}

async function seedStock(ref, data) {
  const { list } = toListWithKeys(data.stock);
  let nextIndex = list.length;

  for (const item of demoStock) {
    const exists = list.some(
      (stockItem) =>
        String(stockItem?.op || "").toUpperCase() === item.op &&
        String(stockItem?.label || "").toUpperCase() === item.label.toUpperCase(),
    );
    if (exists) continue;
    await ref.child(`stock/${nextIndex}`).set({
      ...item,
      company_id: company.id,
      company_name: company.name,
      is_demo: true,
    });
    list.push(item);
    nextIndex += 1;
  }
}

async function main() {
  const password = String(argv.password || "").trim();
  if (!password) {
    throw new Error("Password cannot be empty.");
  }

  const ref = db.ref("itc_data");
  const snap = await ref.once("value");
  const data = snap.val() || {};

  await upsertCompany(ref, data);
  await upsertUserProfiles(ref, data, password);
  await seedStock(ref, data);

  const auditRef = ref.child("platformAuditLogs");
  await auditRef.transaction((logs) => {
    const nextLogs = Array.isArray(logs) ? logs : [];
    nextLogs.unshift({
      action: "SEED_DEMO_COMPANY",
      company_id: company.id,
      company_name: company.name,
      accounts: demoAccounts.map((account) => account.email),
      by: "super_admin",
      date: new Date().toLocaleString("fr-FR"),
    });
    return nextLogs.slice(0, 200);
  });

  console.log("Demo company ready:", company.id);
  console.log("Password:", password);
  demoAccounts.forEach((account) => {
    console.log(`${account.role}: ${account.email}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message || error);
    process.exit(1);
  });
