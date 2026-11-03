// Scene-queue tests: the real production code on SQLite (project migrations)
// + in-memory R2, against a simulated Replicate that enforces the real
// limit the account hit ("6 requests per minute with a burst of 1 while you
// have less than $5.0 in credit"), on a simulated clock. Nothing leaves this box.
// Run: npm run test:queue   (Node 22+, uses node:sqlite)
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(mkdtempSync(join(tmpdir(), "mw-queue-")), "lib.mjs");
await build({ entryPoints: [join(HERE, "entry.ts")], bundle: true, platform: "node", format: "esm", outfile: OUT, alias: { "next/headers": join(HERE, "shim-headers.ts") }, logLevel: "warning" });
process.env.REPLICATE_API_TOKEN = "r8_test";
let clock = Date.now();
Date.now = () => clock;
const tick = (ms) => { clock += ms; };
const lib = await import(pathToFileURL(OUT).href);

/* ---------- D1 + R2 ---------- */
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

/* ---------- simulated Replicate ---------- */
const P = { preds: new Map(), n: 0, creates: [], throttled: 0, lastCreate: -1e15, burstMs: 10_000, credit: true, script: new Map(), sceneMs: 60_000, stitchFails: 0, stitchInputs: [], files: 0 };
function resetProvider(opts = {}) { Object.assign(P, { preds: new Map(), n: 0, creates: [], throttled: 0, lastCreate: -1e15, burstMs: 10_000, credit: true, script: new Map(), sceneMs: 60_000, stitchFails: 0, stitchInputs: [], files: 0 }, opts); }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
function running() { return [...P.preds.values()].filter((p) => !p.stitch && p.status === "processing" && clock < p.doneAt).length; }
let maxRunning = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const method = (init.method || "GET").toUpperCase();
  if (url.startsWith("https://replicate.delivery/")) return new Response(new Uint8Array(20000), { headers: { "content-type": "video/mp4", "content-length": "20000" } });
  if (url === "https://api.replicate.com/v1/files" && method === "POST") { P.files += 1; return json({ id: `f${P.files}`, urls: { get: `https://api.replicate.com/v1/files/f${P.files}` } }, 201); }
  if (/\/predictions$/.test(url) && method === "POST") {
    // The account limit: one new request per 10 s while credit < $5.
    if (clock - P.lastCreate < P.burstMs) { P.throttled += 1; return json({ title: "Request was throttled", detail: "Request was throttled. Your rate limit for creating predictions is reduced to 6 requests per minute with a burst of 1 requests while you have less than $5.0 in credit. Your rate limit resets in ~8s.", status: 429 }, 429, { "retry-after": "8" }); }
    if (!P.credit) return json({ detail: "You have insufficient credit to run this model. Go to https://replicate.com/account/billing#billing to purchase credit." }, 402);
    P.lastCreate = clock;
    const body = JSON.parse(init.body);
    const id = `p${++P.n}`;
    if (url === "https://api.replicate.com/v1/predictions") {
      // The crossfade model's published schema: "task" and "input_file" (a URI) are required.
      if (!body.input?.task) return json({ detail: "- input: task is required\n" }, 422);
      if (!/^https?:\/\//.test(String(body.input?.input_file || ""))) return json({ detail: "- input: input_file is required\n" }, 422);
      P.stitchInputs.push(body.input.urls_csv);
      P.preds.set(id, { stitch: true, status: "processing", doneAt: clock + 30_000, fail: P.stitchFails-- > 0 });
    } else {
      const scene = Number(/scene (\d+)/.exec(String(body.input.prompt))?.[1] || 1) - 1;
      const tries = P.creates.filter((c) => c.scene === scene && c.job === body.input.prompt.split("|")[0]).length;
      const outcomes = P.script.get(scene) || ["ok"];
      const raw = JSON.stringify(body.input);
      P.creates.push({ scene, id, at: clock, job: body.input.prompt.split("|")[0], via: raw.includes("data:image/") ? "inline" : raw.includes("api.replicate.com/v1/files/") ? "file" : "link" });
      P.preds.set(id, { scene, status: "processing", doneAt: clock + P.sceneMs, outcome: outcomes[Math.min(tries, outcomes.length - 1)] });
      maxRunning = Math.max(maxRunning, running());
    }
    return json({ id, status: "starting" }, 201);
  }
  const cancel = /\/predictions\/([^/]+)\/cancel$/.exec(url);
  if (cancel) { const p = P.preds.get(cancel[1]); if (p && p.status === "processing") p.status = "canceled"; return json({}); }
  const get = /\/predictions\/([^/]+)$/.exec(url);
  if (get && method === "GET") {
    const p = P.preds.get(get[1]); if (!p) return json({ detail: "Not found" }, 404);
    if (p.status === "processing" && clock >= p.doneAt) p.status = p.stitch ? (p.fail ? "failed" : "succeeded") : p.outcome === "fail" ? "failed" : "succeeded";
    return json({ id: get[1], status: p.status, output: p.status === "succeeded" ? `https://replicate.delivery/${get[1]}.mp4` : null, error: p.status === "failed" ? "Engine error" : null });
  }
  throw new Error(`unexpected fetch ${method} ${url}`);
};

/* ---------- helpers ---------- */
let pass = 0, fail = 0;
function check(name, ok, detail = "") { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? ` — ${detail}` : ""}`); }
const row = (env, id) => lib.getRenderJob(env, id);
const advance = async (env, id) => { const r = await row(env, id); return lib.advanceRenderJob(env, r, "r8_test", `https://x.test/api/webhooks/replicate/${id}?token=t`); };
async function setLimit(env, n) { await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('provider_max_active', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(String(n)).run(); }
async function newJob(env, scenes, { kind = "studio-series", owner = "owner-1", tag = "job" } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, ?, 'starting', '[]', '[]', NULL, 'p', 'Studio · test film', '720p', 'horizontal', 16, 400, NULL, NULL, ?, ?, ?)`).bind(id, owner, kind, "t".repeat(64), clock, clock).run();
  const inputs = [], photos = [];
  for (let i = 0; i < scenes; i += 1) {
    const link = `https://x.test/api/job-frames/${id}/scene-${String(i + 1).padStart(2, "0")}.jpg?token=t`;
    inputs.push(lib.buildEngineInput("wan3", { imageUrl: link, prompt: `${tag}|slow push in scene ${i + 1}`, duration: 5, resolution: "720p", aspectRatio: "16:9" }));
    photos.push({ key: lib.frameKey(id, i), link });
    await env.BUCKET.put(lib.frameKey(id, i), new Uint8Array(5000), { httpMetadata: { contentType: "image/jpeg" } });
  }
  await lib.saveManifest(env, id, lib.newManifest("wan3", lib.ENGINE_ENDPOINTS.wan3, 5, inputs, undefined, photos));
  return id;
}
async function start(env, id) { const begun = await lib.beginQueue(env, id); if (begun) await advance(env, id); return begun; }
/* Runs the video as the server would (callbacks/heartbeat every few seconds) until it ends. */
async function runToEnd(env, id, { stepMs = 5000, maxMs = 3 * 60 * 60 * 1000, via = "advance" } = {}) {
  const until = clock + maxMs;
  while (clock < until) {
    const r = await row(env, id);
    if (["succeeded", "failed"].includes(r.status)) return r;
    tick(stepMs);
    if (via === "heartbeat") { env.DB.raw.prepare("UPDATE render_jobs SET updated_at = ? WHERE id = ?").run(clock - 60_000, id); await lib.advanceStaleJobs(env, "https://x.test", null, 10); }
    else await advance(env, id);
  }
  return row(env, id);
}
const scenesOf = (job) => P.creates.filter((c) => c.job === job).map((c) => c.scene);
const env0 = () => ({ DB: makeDb(), BUCKET: makeBucket() });

/* 1. 4-scene film, burst limit 1, one at a time */
{
  resetProvider(); maxRunning = 0;
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 4, { tag: "s1" });
  await start(env, id);
  const end = await runToEnd(env, id);
  const order = scenesOf("s1");
  check("1a 4-scene film completes with the provider's burst limit of 1", end.status === "succeeded", end.status + " " + (end.error || ""));
  check("1b scenes sent one after another, in order (1,2,3,4)", order.join(",") === "0,1,2,3", order.join(","));
  check("1c never more than one scene with the engine at once", maxRunning === 1, `max ${maxRunning}`);
  check("1d no request was throttled", P.throttled === 0, `${P.throttled}`);
  const hist = await env.DB.prepare("SELECT id FROM generation_history WHERE id = ?").bind(id).first();
  check("1e finished film saved to History", Boolean(hist) && end.historyId === id);
  check("1f every finished scene kept in our storage", [0, 1, 2, 3].every((i) => env.BUCKET.store.has(lib.outputKey(id, i))));
}

/* 2. 429 on scene 2, automatic wait, completes — the exact failure from production */
{
  resetProvider(); maxRunning = 0;
  const env = env0(); await setLimit(env, 4); // misconfigured too high on purpose: 429s must still be safe
  const id = await newJob(env, 4, { tag: "s2" });
  await start(env, id);
  let r = await row(env, id);
  const m = lib.normalizeManifest(await lib.loadManifest(env, id));
  check("2a scene 2 throttled right after scene 1: scheduled to retry, not failed", r.status === "generating" && P.throttled >= 1 && m.states[1] === "retry" && m.reasons[1] === "throttle", `${r.status} ${m.states[1]}/${m.reasons[1]} throttled=${P.throttled}`);
  check("2b the wait respects the provider's 'resets in ~8s' (at least 10 s)", m.nextAt[1] - clock >= 10_000, `${Math.round((m.nextAt[1] - clock) / 1000)} s`);
  check("2c scene 1 kept running (film not restarted)", m.states[0] === "creating" && scenesOf("s2").length === 1);
  const end = await runToEnd(env, id, { stepMs: 3000 });
  const per = [0, 1, 2, 3].map((s) => scenesOf("s2").filter((x) => x === s).length);
  check("2d film completes after waiting out the throttling", end.status === "succeeded", end.status);
  check("2e exactly one engine job per scene (throttled sends never duplicate)", per.every((n) => n === 1), per.join(","));
}

/* 3–4. Refresh / worker restart while a retry is scheduled: the heartbeat alone finishes it */
{
  resetProvider(); maxRunning = 0;
  const env = env0(); await setLimit(env, 2);
  const id = await newJob(env, 3, { tag: "s3" });
  await start(env, id); // scene 2 throttled → retry scheduled (persisted)
  const m = lib.normalizeManifest(await lib.loadManifest(env, id));
  check("3a the retry time is stored with the job (survives a restart)", m.nextAt.some((t) => t > clock));
  // No page, no callback: a "restarted" server only has the minute heartbeat.
  const end = await runToEnd(env, id, { stepMs: 60_000, via: "heartbeat" });
  check("3b the once-a-minute heartbeat alone carries it to the finished film", end.status === "succeeded", end.status);
  check("3c still one engine job per scene", [0, 1, 2].every((s) => scenesOf("s3").filter((x) => x === s).length === 1));
}

/* 5. Duplicate Generate / Resume clicks */
{
  resetProvider();
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 3, { tag: "s5" });
  const begun = await Promise.all([lib.beginQueue(env, id), lib.beginQueue(env, id), lib.beginQueue(env, id)]);
  check("5a five quick 'Generate' clicks start the video once", begun.filter(Boolean).length === 1, begun.join(","));
  await Promise.all(Array.from({ length: 5 }, () => advance(env, id)));
  check("5b simultaneous checks/callbacks send scene 1 once", scenesOf("s5").length === 1, scenesOf("s5").join(","));
  // stop it, then three Resume clicks at once
  P.script.set(1, ["fail", "fail", "fail"]);
  let end = await runToEnd(env, id);
  check("5c a scene that fails 3 times stops the film", end.status === "failed", end.status);
  const before = P.creates.length;
  const resumes = await Promise.all([1, 2, 3].map(async () => lib.applyJobAction(env, await row(env, id), "resume", null)));
  check("5d three Resume clicks at once: one takes effect", resumes.filter((r) => r.ok).length === 1, JSON.stringify(resumes.map((r) => r.ok || r.error)));
  P.script.set(1, ["ok"]);
  await Promise.all(Array.from({ length: 4 }, () => advance(env, id)));
  check("5e and no duplicate engine job came from it", P.creates.length - before <= 1, `${P.creates.length - before}`);
}

/* 6. One scene permanently failing; finished scenes preserved; retry that scene */
{
  resetProvider();
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 4, { tag: "s6" });
  P.script.set(2, ["fail", "fail", "fail", "ok"]);
  await start(env, id);
  let end = await runToEnd(env, id);
  const m = lib.normalizeManifest(await lib.loadManifest(env, id));
  check("6a film stops only after scene 3 used its 3 tries", end.status === "failed" && m.attempts[2] === 3 && /Scene 3/.test(end.error), end.error);
  check("6b scenes 1 and 2 are kept (ready, copies stored)", m.states[0] === "ready" && m.states[1] === "ready" && env.BUCKET.store.has(lib.outputKey(id, 0)));
  const sent1 = scenesOf("s6").filter((s) => s === 0).length;
  const result = await lib.runJobAction(env, end, "retry-scene", 2, "r8_test", "https://x.test/hook");
  end = await runToEnd(env, id);
  check("6c 'Retry this scene' finishes the film", result.ok && end.status === "succeeded", end.status);
  check("6d scene 1 was never made again", scenesOf("s6").filter((s) => s === 0).length === sent1 && sent1 === 1);
}

/* 7. Client order: no double charge, credit restored once on final failure */
{
  resetProvider();
  const env = env0(); await setLimit(env, 1);
  env.DB.raw.prepare("INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES ('cust-1','c@x.test','C','customer','active','free',0,?,?)").run(clock, clock);
  const id = await newJob(env, 3, { kind: "customer-series", owner: "cust-1", tag: "s7" });
  env.DB.raw.prepare("INSERT INTO projects (id, owner_id, title, status, aspect, resolution, generation_engine, target_duration, render_job_id, created_at, updated_at) VALUES ('proj-1','cust-1','Vertical reel','queued','vertical','720p','wan3',15,?,?,?)").run(id, clock, clock);
  env.DB.raw.prepare("INSERT INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES ('l1','cust-1','proj-1',NULL,-1,'project_reservation','project:proj-1:reservation','',?)").run(clock);
  P.script.set(0, ["fail", "fail", "fail"]);
  await start(env, id);
  const end = await runToEnd(env, id);
  await lib.advanceRenderJob(env, end, "r8_test"); // a late duplicate callback
  const refunds = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE type = 'automatic_refund'").get().n;
  const balance = env.DB.raw.prepare("SELECT credit_balance AS b FROM users WHERE id='cust-1'").get().b;
  check("7a final failure restores the client's credit exactly once", end.status === "failed" && refunds === 1 && balance === 1, `refunds=${refunds} balance=${balance}`);
  const project = env.DB.raw.prepare("SELECT status FROM projects WHERE id='proj-1'").get();
  check("7b the client's order shows it needs attention (not stuck)", project.status === "failed", project.status);
  const note = env.DB.raw.prepare("SELECT message FROM notifications WHERE owner_id='cust-1' AND type='generation_failed'").get();
  check("7c the client sees plain language, not provider details", note && !/Engine error|replicate|prediction/i.test(note.message), note?.message);
}

/* 8. Provider out of credit: production pauses, nothing fails, then continues */
{
  resetProvider({ credit: false });
  const env = env0(); await setLimit(env, 1);
  env.DB.raw.prepare("INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES ('owner-1','o@x.test','O','admin','active','internal',0,?,?)").run(clock, clock);
  const id = await newJob(env, 2, { tag: "s8" });
  await start(env, id);
  for (let i = 0; i < 6; i += 1) { tick(30_000); await advance(env, id); }
  const state = await lib.readProviderState(env);
  const r = await row(env, id);
  const alert = env.DB.raw.prepare("SELECT title FROM notifications WHERE owner_id='owner-1' AND type='provider_alert'").get();
  check("8a out of credit: the video waits in line (not failed)", r.status === "generating", r.status);
  check("8b production is paused and the manager is alerted", state.pausedUntil > 0 && state.lowCredit && Boolean(alert), alert?.title);
  P.credit = true;
  const end = await runToEnd(env, id, { stepMs: 30_000 });
  check("8c once credit is back it continues to the finished film", end.status === "succeeded", end.status);
}

/* 9. Joining throttled: waits, not failed */
{
  resetProvider({ sceneMs: 5_000 });
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 2, { tag: "s9" });
  await start(env, id);
  // finish both scenes quickly, then make the join request collide with the burst limit
  let guard = 0;
  while ((await row(env, id)).status === "generating" && guard++ < 200) { tick(2000); await advance(env, id); }
  const r = await row(env, id);
  check("9a joining starts (or waits for the engine) — never fails on a throttle", ["stitching", "saving", "succeeded"].includes(r.status), `${r.status} throttled=${P.throttled}`);
  const end = await runToEnd(env, id);
  check("9b film finished", end.status === "succeeded");
}

/* 10. Long one-at-a-time film: joining uses our stored copies once the engine's expire */
{
  resetProvider({ sceneMs: 20 * 60_000 });
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 4, { tag: "s10" });
  await start(env, id);
  const end = await runToEnd(env, id, { stepMs: 60_000 });
  const csv = P.stitchInputs.at(-1) || "";
  check("10a an 80-minute one-at-a-time film still finishes", end.status === "succeeded", end.status);
  check("10b joining used our kept copies for scenes older than 45 minutes", csv.includes("/api/job-frames/") && csv.includes("out-01.mp4"), csv.slice(0, 140));
}

/* 11. Regenerate one scene of a finished film → new version in History */
{
  resetProvider();
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 3, { tag: "s11" });
  await start(env, id);
  let end = await runToEnd(env, id);
  const before = scenesOf("s11").length;
  const result = await lib.runJobAction(env, end, "regenerate-scene", 1, "r8_test", "https://x.test/hook");
  end = await runToEnd(env, id);
  const versions = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM generation_history WHERE owner_id='owner-1'").get().n;
  check("11a regenerating scene 2 makes only that scene again", result.ok && scenesOf("s11").length === before + 1 && scenesOf("s11").at(-1) === 1, scenesOf("s11").join(","));
  check("11b and saves a new version of the film (the first stays in History)", end.status === "succeeded" && versions === 2, `versions=${versions}`);
}

/* 12. A video started by the previous version (all scenes sent at once) still finishes */
{
  resetProvider();
  const env = env0();
  const id = await newJob(env, 3, { tag: "s12" });
  P.preds.set("old1", { scene: 0, status: "processing", doneAt: clock + 30_000, outcome: "ok" });
  P.preds.set("old2", { scene: 1, status: "processing", doneAt: clock + 30_000, outcome: "fail" });
  P.preds.set("old3", { scene: 2, status: "processing", doneAt: clock + 30_000, outcome: "ok" });
  env.DB.raw.prepare("UPDATE render_jobs SET status='generating', prediction_ids=?, segment_urls='[]' WHERE id=?").run(JSON.stringify(["old1", "old2", "old3"]), id);
  const end = await runToEnd(env, id);
  check("12a an in-flight video from the previous version finishes (its failed scene redone)", end.status === "succeeded", end.status + " " + (end.error || ""));
}

/* 13. Start over: a clean new run with the same photos and settings */
{
  resetProvider();
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 2, { tag: "s13" });
  P.script.set(0, ["fail", "fail", "fail"]);
  await start(env, id);
  const stopped = await runToEnd(env, id);
  P.script.set(0, ["ok"]);
  const result = await lib.startOverJob(env, stopped, "r8_test", "https://x.test");
  const end = await runToEnd(env, result.id);
  check("13a 'Start over' makes a fresh run from the same photos and finishes", Boolean(result.id) && result.id !== id && end.status === "succeeded", end.status);
  check("13b the new run has its own copy of the photos", env.BUCKET.store.has(lib.frameKey(result.id, 0)));
}

/* 14. A failing scene's photo reaches the engine a different way on each try */
{
  resetProvider();
  const env = env0(); await setLimit(env, 1);
  const id = await newJob(env, 2, { tag: "s14" });
  P.script.set(0, ["fail", "fail", "ok"]);
  await start(env, id);
  const end = await runToEnd(env, id);
  const vias = P.creates.filter((c) => c.job === "s14" && c.scene === 0).map((c) => c.via);
  check("14a tries: engine file storage → private link → inline photo", vias.join(",") === "file,link,inline" && end.status === "succeeded", vias.join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
