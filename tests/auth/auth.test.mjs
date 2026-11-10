// Auth tests: no API route accepts a caller-supplied identity header, and
// history is reachable only by the owning signed-in account. The real
// production code runs on SQLite (project migrations), with a controllable
// request-headers stand-in. Nothing leaves this box.
// Run: npm run test:auth (Node 22+, uses node:sqlite)
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(mkdtempSync(join(tmpdir(), "mw-auth-")), "lib.mjs");
await build({ entryPoints: [join(HERE, "entry.ts")], bundle: true, platform: "node", format: "esm", outfile: OUT, alias: { "next/headers": join(HERE, "shim-headers.ts") }, logLevel: "warning" });

/* The old flag must have no effect anywhere, even when set: the header path
   is removed, not just switched off. */
process.env.TRUST_IDENTITY_HEADERS = "1";
const lib = await import(pathToFileURL(OUT).href);

/* No provider call is expected on any of these paths. */
globalThis.fetch = async () => { throw new Error("unexpected fetch — this path must not call the provider"); };

/* ---------- D1 (same shape as the failed-orders harness) ---------- */
function makeDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(`${REPO}/drizzle`).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${REPO}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
      const sql = statement.trim(); if (!sql) continue;
      try { db.exec(sql); } catch (error) { if (!/already exists|duplicate column/i.test(error.message)) throw new Error(`${file}: ${error.message}`); }
    }
  }
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) }, results: [] }; },
  });
  return { raw: db, prepare: (sql) => wrap(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
function makeEnv() { return { DB: makeDb(), FRAME_MOTION_ADMIN_EMAILS: "admin@test.local" }; }

/* ---------- helpers ---------- */
let pass = 0, fail = 0;
function check(name, ok, detail = "") { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? ` — ${detail}` : ""}`); }
async function expectHttpError(name, fn, status, text) {
  try { await fn(); check(name, false, "expected an HttpError"); }
  catch (err) { check(name, err.status === status && String(err.message).includes(text), `got ${err.status}: ${err.message}`); }
}

const ADMIN_EMAIL = "admin@test.local";
const CUSTOMER_A = "email:a@test.local";
const CUSTOMER_B = "email:b@test.local";

function setRequestHeaders({ sessionToken = null, forgedId = null, forgedEmail = null } = {}) {
  const headers = new Headers();
  const cookies = [];
  if (sessionToken) cookies.push(`motionwren_session=${encodeURIComponent(sessionToken)}`);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  if (forgedId) headers.set("oai-authenticated-user-id", forgedId);
  if (forgedEmail) headers.set("oai-authenticated-user-email", forgedEmail);
  globalThis.__testHeaders = headers;
}

async function seedUser(env, id, email, role = "customer") {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'free', 0, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(id, email, email, role, now, now).run();
}

/* A real session row, the way createGoogleSession writes it: the cookie
   carries the raw token, the table carries its SHA-256 hex. */
async function seedSession(env, userId) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), userId, tokenHash, now + 60 * 60 * 1000, now).run();
  return token;
}

/* ---------- 1. requireAccount: forged identity headers grant nothing ---------- */
{
  const env = makeEnv();
  await seedUser(env, "google:admin-sub", ADMIN_EMAIL, "admin");
  await seedUser(env, CUSTOMER_A, "a@test.local");
  await seedUser(env, CUSTOMER_B, "b@test.local");

  setRequestHeaders({ forgedId: "google:admin-sub", forgedEmail: ADMIN_EMAIL });
  await expectHttpError("1a forged admin headers, no session -> 401", () => lib.requireAccount(env), 401, "Authentication required");

  setRequestHeaders({ forgedId: CUSTOMER_B, forgedEmail: "b@test.local" });
  await expectHttpError("1b forged customer headers, no session -> 401", () => lib.requireAccount(env), 401, "Authentication required");

  setRequestHeaders({ forgedId: CUSTOMER_B, forgedEmail: "b@test.local" });
  // Even a signed-in customer cannot use headers to become someone else.
  const sessionA = await seedSession(env, CUSTOMER_A);
  setRequestHeaders({ sessionToken: sessionA, forgedId: CUSTOMER_B, forgedEmail: "b@test.local" });
  const account = await lib.requireAccount(env);
  check("1c session + forged headers for another account -> the session account, not the header", account.id === CUSTOMER_A && account.email === "a@test.local" && account.role === "customer", `${account.id} / ${account.email} / ${account.role}`);

  setRequestHeaders({ forgedId: "google:admin-sub", forgedEmail: ADMIN_EMAIL });
  const adminSession = await seedSession(env, "google:admin-sub");
  setRequestHeaders({ sessionToken: adminSession, forgedId: CUSTOMER_B, forgedEmail: "b@test.local" });
  const admin = await lib.requireAccount(env);
  check("1d admin session stays admin even with forged customer headers", admin.id === "google:admin-sub" && admin.role === "admin", `${admin.id} / ${admin.role}`);
}

/* ---------- 2. historyOwnerIds: only the signed-in session ---------- */
{
  const env = makeEnv();
  await seedUser(env, CUSTOMER_A, "a@test.local");
  await seedUser(env, CUSTOMER_B, "b@test.local");

  setRequestHeaders({ forgedId: CUSTOMER_B, forgedEmail: "b@test.local" });
  check("2a forged headers, no session -> no owner ids", (await lib.historyOwnerIds(env)).length === 0, JSON.stringify(await lib.historyOwnerIds(env)));

  const sessionA = await seedSession(env, CUSTOMER_A);
  setRequestHeaders({ sessionToken: sessionA });
  const ids = await lib.historyOwnerIds(env);
  check("2b signed-in customer A -> only A's id", ids.length === 1 && ids[0] === CUSTOMER_A, JSON.stringify(ids));

  setRequestHeaders({ sessionToken: sessionA, forgedId: CUSTOMER_B, forgedEmail: "b@test.local" });
  const idsForged = await lib.historyOwnerIds(env);
  check("2c session A + forged headers for B -> only A, never B", idsForged.length === 1 && idsForged[0] === CUSTOMER_A, JSON.stringify(idsForged));

  setRequestHeaders({});
  check("2d no session, no headers -> no owner ids", (await lib.historyOwnerIds(env)).length === 0);
}

/* ---------- 3. isOwnerRequest: session admin only ---------- */
{
  const env = makeEnv();
  await seedUser(env, "google:admin-sub", ADMIN_EMAIL, "admin");
  await seedUser(env, CUSTOMER_A, "a@test.local");

  setRequestHeaders({ forgedId: "google:admin-sub", forgedEmail: ADMIN_EMAIL });
  check("3a forged owner headers, no session -> not owner", (await lib.isOwnerRequest(env)) === false);

  const adminSession = await seedSession(env, "google:admin-sub");
  setRequestHeaders({ sessionToken: adminSession });
  check("3b signed-in admin session -> owner", (await lib.isOwnerRequest(env)) === true);

  const sessionA = await seedSession(env, CUSTOMER_A);
  setRequestHeaders({ sessionToken: sessionA });
  check("3c signed-in customer session -> not owner", (await lib.isOwnerRequest(env)) === false);

  setRequestHeaders({ sessionToken: sessionA, forgedId: "google:admin-sub", forgedEmail: ADMIN_EMAIL });
  check("3d customer session + forged owner headers -> not owner", (await lib.isOwnerRequest(env)) === false);

  setRequestHeaders({});
  check("3e no session -> not owner", (await lib.isOwnerRequest(env)) === false);
}

/* ---------- 4. The unsigned-cookie / header identity path is gone ---------- */
check("4a render-jobs no longer exports currentOwner", lib.currentOwner === undefined, typeof lib.currentOwner);
check("4b render-jobs no longer exports setOwnerCookie", lib.setOwnerCookie === undefined, typeof lib.setOwnerCookie);
check("4c render-jobs no longer exports OWNER_COOKIE", lib.OWNER_COOKIE === undefined, String(lib.OWNER_COOKIE));
check("4d history-owners no longer exports HISTORY_COOKIE", lib.HISTORY_COOKIE === undefined, String(lib.HISTORY_COOKIE));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
