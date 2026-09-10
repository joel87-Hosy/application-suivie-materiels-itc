// test_security_login.js
// Signs in as a Firebase Auth user and verifies Realtime Database access.
// Usage:
//   npm run test-security-login -- --email user@example.com --password Secret123!

const yargs = require("yargs");

const argv = yargs
  .option("email", {
    type: "string",
    demandOption: true,
  })
  .option("password", {
    type: "string",
    demandOption: true,
  })
  .help().argv;

const apiKey = "AIzaSyD7P-6vY3yHQx7OFCs6th6gN6EURP89QUQ";
const databaseURL = "https://itc-erp-default-rtdb.europe-west1.firebasedatabase.app";

async function signIn(email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || "Firebase Auth sign-in failed.");
  }
  return {token:body.idToken, uid:body.localId};
}

async function databaseGet(path, token, companyId) {
  const params = new URLSearchParams({auth:token});
  if (companyId) {
    params.set('orderBy', JSON.stringify('company_id'));
    params.set('equalTo', JSON.stringify(companyId));
  }
  const response = await fetch(`${databaseURL}/${path}.json?${params}`);
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function anonymousGet(path) {
  const response = await fetch(`${databaseURL}/${path}.json`);
  return {
    ok: response.ok,
    status: response.status,
  };
}

async function main() {
  const email = String(argv.email || "").trim().toLowerCase();
  const {token, uid} = await signIn(email, argv.password);
  const own = await databaseGet(`auth_profiles/${uid}`, token);
  if (!own.ok) throw new Error('Security profile read denied.');
  const profile = JSON.parse(own.body);
  if (!profile?.is_active || !profile.company_id) throw new Error('Inactive or missing security profile.');
  const securedRead = await databaseGet("itc_data/users", token, profile.role === 'SUPER_ADMIN' ? null : profile.company_id);
  const anonymousRead = await anonymousGet("itc_data/users");
  const rootRead = await databaseGet('itc_data',token);

  if (!securedRead.ok) {
    throw new Error(`Authenticated database read failed with HTTP ${securedRead.status}`);
  }
  if (![401,403].includes(anonymousRead.status) || ![401,403].includes(rootRead.status)) {
    throw new Error("Expected permission denied for anonymous and global reads.");
  }

  console.log("Login and rules test OK:", email);
  console.log("Authenticated read HTTP:", securedRead.status);
  console.log("Anonymous read blocked HTTP:", anonymousRead.status);
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
