// Failed-order tests: the holding state, the opt-in refund, and the
// heartbeat exclusion for manager-replaced jobs — the real production code
// on SQLite (project migrations) + in-memory R2, on a simulated clock.
// Nothing leaves this box. Run: npm run test:failed-orders
// (Node 22+, uses node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(mkdtempSync(join(tmpdir(), "mw-failed-")), "lib.mjs");
await build({ entryPoints: [join(HERE, "entry.ts")], bundle: true, platform: "node", format: "esm", outfile: OUT, alias: { "next/headers": join(HERE, "..", "scene-queue", "shim-headers.ts") }, logLevel: "warning" });
process.env.REPLICATE_API_TOKEN = "r8_test";
let clock = Date.now();
Date.now = () => clock;
const lib = await import(pathToFileURL(OUT).href);

/* No provider call is expected on any of these paths: if one happens, the
   test fails loudly instead of silently spending engine money. */
globalThis.fetch = async () => { throw new Error("unexpected fetch — this path must not call the provider"); };

/* ---------- D1 + R2 (same shape as the scene-queue harness) ---------- */
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
function makeBucket() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.has(key) ? { body: new Blob([store.get(key).value]).stream(), text: async () => String(store.get(key).value), httpMetadata: store.get(key).meta } : null,
    head: async (key) => store.has(key) ? { size: store.get(key).value.length } : null,
    put: async (key, value, options = {}) => { let v = value; if (value && typeof value.getReader === "function") v = Buffer.from(await new Response(value).arrayBuffer()); else if (value instanceof ArrayBuffer) v = Buffer.from(value); store.set(key, { value: typeof v === "string" ? v : Buffer.from(v), meta: options.httpMetadata }); },
    delete: async (key) => { store.delete(key); },
  };
}
function makeEnv() { return { DB: makeDb(), BUCKET: makeBucket() }; }

/* ---------- helpers ---------- */
let pass = 0, fail = 0;
function check(name, ok, detail = "") { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? ` — ${detail}` : ""}`); }
async function expectHttpError(name, fn, status, text) {
  try { await fn(); check(name, false, "expected an HttpError"); }
  catch (err) { check(name, err.status === status && String(err.message).includes(text), `got ${err.status}: ${err.message}`); }
}
const countRows = (env, table, where = "") => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get().n;
const getOne = (env, sql, ...params) => env.DB.raw.prepare(sql).get(...params);
const HOUR = 60 * 60 * 1000;

/* A customer order: one admin (so manager alerts have somewhere to go),
   one customer, one project pointing at one customer-series render job,
   an optional recovery count, and an optional reserved credit. */
async function seedOrder(env, { owner = "owner-1", jobStatus = "generating", jobError = null, jobUpdatedAt = clock, projectStatus = "generating", recoveries = 0, reserved = false, renderJobId = undefined } = {}) {
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES ('admin-1', 'admin@test.local', 'Admin', 'admin', 'active', 'internal', 0, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(clock, clock).run();
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES (?, ?, 'Owner One', 'customer', 'active', 'internal', 0, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(owner, `${owner}@test.local`, clock, clock).run();
  const projectId = crypto.randomUUID();
  const jobId = renderJobId === null ? null : crypto.randomUUID();
  if (jobId) {
    await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'customer-series', ?, '[]', '[]', NULL, 'p', 'Studio · test film', '720p', 'horizontal', 16, 400, ?, NULL, ?, ?, ?)`).bind(jobId, owner, jobStatus, jobError, "t".repeat(64), clock, jobUpdatedAt).run();
  }
  await env.DB.prepare(`INSERT INTO projects (id, owner_id, title, status, render_job_id, created_at, updated_at) VALUES (?, ?, 'Hero listing film', ?, ?, ?, ?)`).bind(projectId, owner, projectStatus, jobId, clock, clock).run();
  if (recoveries) await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`job_recoveries:${jobId}`, String(recoveries), clock).run();
  if (reserved) await env.DB.prepare(`INSERT INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, ?, ?, -1, 'project_reservation', ?, 'Reserved for project', ?)`).bind(crypto.randomUUID(), owner, projectId, jobId, `project:${projectId}:reservation`, clock).run();
  return { projectId, jobId };
}

/* ---------- isHoldingJob ---------- */
check("isHoldingJob: failed + 3 recoveries is holding", lib.isHoldingJob({ status: "failed", updatedAt: clock, error: "Engine error" }, 3, clock));
check("isHoldingJob: failed + recent + 0 recoveries is not holding", !lib.isHoldingJob({ status: "failed", updatedAt: clock, error: "Engine error" }, 0, clock));
check("isHoldingJob: failed + 7h old is holding", lib.isHoldingJob({ status: "failed", updatedAt: clock - 7 * HOUR, error: "Engine error" }, 0, clock));
check("isHoldingJob: a Stopped job is never holding", !lib.isHoldingJob({ status: "failed", updatedAt: clock - 7 * HOUR, error: "Stopped by user." }, 3, clock));
check("isHoldingJob: generating is not holding", !lib.isHoldingJob({ status: "generating", updatedAt: clock, error: null }, 3, clock));
check("isHoldingJob: null job is not holding", !lib.isHoldingJob(null, 3, clock));

/* ---------- failRenderJob, recoveries not yet used up ---------- */
{
  const env = makeEnv();
  const { jobId } = await seedOrder(env, { recoveries: 0, reserved: false });
  const row = await lib.getRenderJob(env, jobId);
  await lib.failRenderJob(env, row, "Engine error");
  const job = await lib.getRenderJob(env, jobId);
  check("fail < 3: job is failed", job.status === "failed");
  check("fail < 3: project stays generating (customer is not told it failed)", getOne(env, `SELECT status FROM projects WHERE render_job_id = ?`, jobId).status === "generating");
  check("fail < 3: no customer notification", countRows(env, "notifications", `WHERE type = 'production_delayed'`) === 0);
  check("fail < 3: no manager alert", countRows(env, "notifications", `WHERE type = 'provider_alert'`) === 0);
  check("fail < 3: no refund", countRows(env, "credit_ledger", `WHERE type = 'automatic_refund'`) === 0);
}

/* ---------- failRenderJob, retries used up: told once, never refunded automatically ---------- */
{
  const env = makeEnv();
  const { jobId } = await seedOrder(env, { recoveries: 3, reserved: true });
  await lib.failRenderJob(env, await lib.getRenderJob(env, jobId), "Engine error");
  await lib.failRenderJob(env, await lib.getRenderJob(env, jobId), "Engine error");
  const job = await lib.getRenderJob(env, jobId);
  check("fail >= 3: job is failed", job.status === "failed");
  check("fail >= 3: project stays generating", getOne(env, `SELECT status FROM projects WHERE render_job_id = ?`, jobId).status === "generating");
  check("fail >= 3: holding notification created exactly once across two calls", countRows(env, "notifications", `WHERE type = 'production_delayed'`) === 1);
  check("fail >= 3: holding notification says taking longer, never failed", getOne(env, `SELECT message FROM notifications WHERE type = 'production_delayed'`).message === lib.HOLDING_MESSAGE);
  check("fail >= 3: manager alert created", countRows(env, "notifications", `WHERE type = 'provider_alert'`) === 1);
  check("fail >= 3: no automatic refund even with a reservation present", countRows(env, "credit_ledger", `WHERE type = 'automatic_refund'`) === 0);
  check("fail >= 3: credit balance untouched", getOne(env, `SELECT credit_balance FROM users WHERE id = 'owner-1'`).credit_balance === 0);
}

/* ---------- refundHoldingOrder: success ---------- */
{
  const env = makeEnv();
  const { projectId, jobId } = await seedOrder(env, { jobStatus: "failed", recoveries: 3, reserved: true });
  const result = await lib.refundHoldingOrder(env, projectId, "owner-1");
  check("refund: returns refunded + balance", result.refunded === true && result.creditBalance === 1, JSON.stringify(result));
  check("refund: credit balance is 1", getOne(env, `SELECT credit_balance FROM users WHERE id = 'owner-1'`).credit_balance === 1);
  check("refund: exactly one refund ledger row", countRows(env, "credit_ledger", `WHERE type = 'automatic_refund'`) === 1);
  check("refund: project is cancelled", getOne(env, `SELECT status FROM projects WHERE id = ?`, projectId).status === "cancelled");
  check("refund: job error stops the heartbeat from resurrecting it", (await lib.getRenderJob(env, jobId)).error === "Stopped by customer refund.");
  check("refund: refund notification created", countRows(env, "notifications", `WHERE type = 'refund_issued'`) === 1);
  check("refund: audit row created", countRows(env, "audit_events", `WHERE action = 'project.refunded'`) === 1);
  await expectHttpError("refund: second ask is refused", () => lib.refundHoldingOrder(env, projectId, "owner-1"), 409, "not waiting on a fix yet");
  check("refund: second ask returns no second credit", getOne(env, `SELECT credit_balance FROM users WHERE id = 'owner-1'`).credit_balance === 1);
  check("refund: second ask writes no second ledger row", countRows(env, "credit_ledger", `WHERE type = 'automatic_refund'`) === 1);
}

/* ---------- refundHoldingOrder: refusals ---------- */
{
  const env = makeEnv();
  const notHolding = await seedOrder(env, { jobStatus: "failed", recoveries: 0, reserved: true });
  await expectHttpError("refund: not holding yet is refused", () => lib.refundHoldingOrder(env, notHolding.projectId, "owner-1"), 409, "not waiting on a fix yet");
  const noReservation = await seedOrder(env, { jobStatus: "failed", recoveries: 3, reserved: false });
  await expectHttpError("refund: holding without a reservation is refused", () => lib.refundHoldingOrder(env, noReservation.projectId, "owner-1"), 409, "no credit to refund");
  const stillWorking = await seedOrder(env, { jobStatus: "generating", recoveries: 3, reserved: true });
  await expectHttpError("refund: a job still being worked on is refused", () => lib.refundHoldingOrder(env, stillWorking.projectId, "owner-1"), 409, "still being worked on");
  const noVideo = await seedOrder(env, { renderJobId: null });
  await expectHttpError("refund: an order with no video is refused", () => lib.refundHoldingOrder(env, noVideo.projectId, "owner-1"), 409, "no video to refund");
  const otherOwner = await seedOrder(env, { jobStatus: "failed", recoveries: 3, reserved: true });
  await expectHttpError("refund: another owner's project is not found", () => lib.refundHoldingOrder(env, otherOwner.projectId, "someone-else"), 404, "Project not found");
  check("refund: refusals leave the credit balance at 0", getOne(env, `SELECT credit_balance FROM users WHERE id = 'owner-1'`).credit_balance === 0);
}

/* ---------- recoverFailedOrders skips manager-replaced jobs ---------- */
{
  const env = makeEnv();
  const { jobId } = await seedOrder(env, { jobStatus: "failed", jobError: "Replaced by a new run.", jobUpdatedAt: clock - HOUR, recoveries: 0 });
  await lib.recoverFailedOrders(env);
  const job = await lib.getRenderJob(env, jobId);
  check("heartbeat: a replaced job is not resumed", job.status === "failed" && job.error === "Replaced by a new run.");
  check("heartbeat: a replaced job gains no recovery count", (await lib.getRecoveries(env, jobId)) === 0);
}

/* ---------- dashboard grouping: cancelled is its own group, never failed ---------- */
check("groupOf('cancelled') is cancelled", lib.groupOf("cancelled") === "cancelled");
{
  const orders = lib.buildOrders([{ id: "p1", title: "Hero listing film", status: "cancelled", listingAddress: null, shortMessage: null, assetCount: 0, aspect: "horizontal", resolution: "720p", targetDuration: null, createdAt: clock, updatedAt: clock, finalHistoryId: null, coverAssetId: null, videoExpiresAt: null, jobStatus: null, scenesReady: null, scenesTotal: null }]);
  check("buildOrders puts a cancelled project in the cancelled group", orders.length === 1 && orders[0].group === "cancelled", orders.length ? orders[0].group : "no orders");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
