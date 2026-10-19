"use strict";

// Standalone business API foundation. This process is intended to sit behind
// Nginx on localhost and is not yet a drop-in replacement for Supabase.
const http = require("node:http");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || "");
const DB_AUTHENTICATED_ROLE = process.env.DB_AUTHENTICATED_ROLE || "authenticated";
const SESSION_TTL_SECONDS = Math.min(86400, Math.max(300, Number(process.env.SESSION_TTL_SECONDS || 28800)));
const MAX_BODY_BYTES = 1024 * 1024;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000 }) : null;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Corps de requête trop volumineux."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("JSON invalide."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verifySession(token) {
  if (!SESSION_SECRET || !token) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(mac, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!session.sub || !Number.isInteger(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch { return null; }
}

function parseCookies(header) {
  return Object.fromEntries(String(header || "").split(";").map(part => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

async function withUserTransaction(userId, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL ROLE is parameterless; allow only a fixed, validated role name.
    if (!/^[a-z_][a-z0-9_]*$/i.test(DB_AUTHENTICATED_ROLE)) throw new Error("Rôle PostgreSQL invalide.");
    await client.query(`SET LOCAL ROLE ${DB_AUTHENTICATED_ROLE}`);
    // The identity is transaction-local so pooled connections cannot leak it.
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main(req, res) {
  if (req.method === "GET" && req.url === "/api/health") {
    if (!pool) return json(res, 503, { ok: false, error: "Backend non configuré." });
    try {
      await pool.query("SELECT 1");
      return json(res, 200, { ok: true, service: "gestion-backend", database: "connected" });
    } catch {
      return json(res, 503, { ok: false, error: "Base de données indisponible." });
    }
  }
  if (req.method === "POST" && req.url === "/api/auth/login") {
    if (!pool || !SESSION_SECRET) return json(res, 503, { error: "Backend non configuré." });
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password || email.length > 320 || password.length > 1024) {
      return json(res, 400, { error: "Adresse courriel ou mot de passe invalide." });
    }
    const result = await pool.query(
      `SELECT id, encrypted_password
         FROM auth.users
        WHERE lower(email) = $1 AND deleted_at IS NULL`,
      [email],
    );
    if (result.rowCount !== 1 || !result.rows[0].encrypted_password || !/^\$2[aby]\$/.test(result.rows[0].encrypted_password)) {
      return json(res, 401, { error: "Identifiants invalides." });
    }
    const account = result.rows[0];
    if (!(await bcrypt.compare(password, account.encrypted_password))) return json(res, 401, { error: "Identifiants invalides." });
    let profile;
    try {
      profile = await withUserTransaction(account.id, client => client.query(
        "SELECT user_id, company_id, role FROM public.app_profiles WHERE user_id = $1::uuid AND is_active",
        [account.id],
      ));
    } catch {
      return json(res, 503, { error: "Schéma applicatif ou rôle SQL pas encore prêt." });
    }
    if (profile.rowCount !== 1) return json(res, 401, { error: "Identifiants invalides." });
    const now = Math.floor(Date.now() / 1000);
    const token = signSession({ sub: account.id, iat: now, exp: now + SESSION_TTL_SECONDS });
    res.setHeader("set-cookie", `gestion_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`);
    return json(res, 200, { user: { id: account.id, email, company_id: profile.rows[0].company_id, role: profile.rows[0].role }, expires_at: now + SESSION_TTL_SECONDS });
  }
  if (req.method === "POST" && req.url === "/api/auth/logout") {
    res.setHeader("set-cookie", "gestion_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    return json(res, 200, { ok: true });
  }
  if (!req.url.startsWith("/api/")) return json(res, 404, { error: "Introuvable." });
  if (!pool || !SESSION_SECRET) return json(res, 503, { error: "Backend non configuré." });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || parseCookies(req.headers.cookie).gestion_session;
  const session = verifySession(token);
  if (!session) return json(res, 401, { error: "Session invalide ou expirée." });
  try {
    return await withUserTransaction(session.sub, async client => {
      const profile = await client.query(
        "SELECT user_id, company_id, role, is_active FROM public.app_profiles WHERE user_id = $1::uuid AND is_active",
        [session.sub],
      );
      if (profile.rowCount !== 1) return json(res, 403, { error: "Compte applicatif inactif ou introuvable." });
      // No generic SQL/RPC dispatcher is exposed. Add explicit, authorized routes
      // only after their request schemas and business permission checks are ported.
      return json(res, 501, { error: "Route métier pas encore migrée." });
    });
  } catch {
    return json(res, 503, { error: "Schéma applicatif ou rôle SQL pas encore prêt." });
  }
}

const server = http.createServer((req, res) => {
  main(req, res).catch(error => {
    const status = Number(error.status) || 500;
    if (!res.headersSent) json(res, status, { error: status < 500 ? error.message : "Erreur interne." });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => console.log(`Backend gestion en écoute sur ${HOST}:${PORT}`));

async function shutdown() {
  server.close();
  if (pool) await pool.end();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
