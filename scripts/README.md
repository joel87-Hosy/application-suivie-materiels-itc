Script: create_firebase_user.js

Purpose:

- Create a Firebase Authentication user via the Admin SDK.
- Add the user's profile to the Realtime Database under `itc_data/users`.
- Seed basic stock entries for the user's managed operators if missing.

Prerequisites:

- A Firebase service account JSON key. Save it as `serviceAccountKey.json` at the repository root (or pass its path via `--serviceAccount` or `GOOGLE_APPLICATION_CREDENTIALS`).
- Node.js (14+ recommended).

Install & run:

```bash
npm install
# Example usage:
node scripts/create_firebase_user.js --email gest_b02@itc.ci --password Secret123! --name "GESTIONNAIRE BUREAU 02" --managedOps ITC-B02,MOOV
```

Notes:

- The script will update `itc_data/users` in the Realtime Database; it tries to preserve existing users and assigns a numeric `id` by taking max+1.
- Do NOT commit your service account key into the repo.
- If you prefer, I can run this for you if you provide the service account key securely.
