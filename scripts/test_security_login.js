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
  return body.idToken;
}

async function databaseGet(path, token) {
  const response = await fetch(`${databaseURL}/${path}.json?auth=${token}`);
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
  const token = await signIn(email, argv.password);
  const securedRead = await databaseGet("itc_data/users", token);
  const anonymousRead = await anonymousGet("itc_data/users");

  if (!securedRead.ok) {
    throw new Error(`Authenticated database read failed with HTTP ${securedRead.status}`);
  }
  if (anonymousRead.ok) {
    throw new Error("Anonymous database read was allowed.");
  }

  console.log("Login and rules test OK:", email);
  console.log("Authenticated read HTTP:", securedRead.status);
  console.log("Anonymous read blocked HTTP:", anonymousRead.status);
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
