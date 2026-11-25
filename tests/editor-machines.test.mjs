/* The editing-machine watchdog, with a pretend database and pretend machines: it must put idle machines to
   sleep and never touch one that is still working on a film. Run: npm run test:machines */
import assert from "node:assert/strict";
import { sleepDecision, MIN_IDLE_MS } from "../worker/sleep-decision.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const MIN = 60_000;
const now = Date.UTC(2026, 10, 25, 12, 0);

// ---- the machine's own answer to a knock ----
{ assert.deepEqual(sleepDecision({ running: false, lastUse: 0, lastRequestAt: 0, inflight: 0, idleMs: 45 * MIN, now }), { stop: false, reason: "asleep" }); ok("a machine that is asleep is left asleep (a knock never starts one)"); }
{ assert.equal(sleepDecision({ running: true, lastUse: now - 2 * MIN, lastRequestAt: now - 2 * MIN, inflight: 0, idleMs: 45 * MIN, now }).stop, false); ok("a machine used 2 minutes ago keeps running"); }
{ assert.equal(sleepDecision({ running: true, lastUse: now - 40 * MIN, lastRequestAt: now - 40 * MIN, inflight: 0, idleMs: 45 * MIN, now }).stop, false); ok("a machine used 40 minutes ago keeps running under the 45-minute rule"); }
{ assert.equal(sleepDecision({ running: true, lastUse: now - 10 * MIN, lastRequestAt: now - 10 * MIN, inflight: 0, idleMs: 1, now }).stop, false); assert.equal(MIN_IDLE_MS, 30 * MIN); ok("the watchdog can never ask for less than 30 minutes idle"); }
{ assert.equal(sleepDecision({ running: true, lastUse: 0, lastRequestAt: now - 5 * MIN, inflight: 1, idleMs: 45 * MIN, now }).reason, "replying"); ok("a machine still sending a reply it was asked for recently keeps running"); }
{ assert.deepEqual(sleepDecision({ running: true, lastUse: now - 60 * MIN, lastRequestAt: now - 60 * MIN, inflight: 1, idleMs: 45 * MIN, now }), { stop: true, reason: "idle" }); ok("a machine idle an hour with a stuck reply (the November bug) is stopped"); }
{ assert.equal(sleepDecision({ running: true, lastUse: 0, lastRequestAt: now - 50 * MIN, inflight: 0, idleMs: 45 * MIN, now }).stop, true); ok("a running machine with no record of use is stopped"); }

// ---- the watchdog's sweep, with a pretend database ----
const { sweepIdleMachines, busyName, containerDollars, IDLE_MS } = await import("../app/api/_lib/editor-machines.ts");

function fakeDb({ machines, jobs, reads = [] }) {
  const settings = new Map();
  const prepare = (sql) => {
    const run = (args) => {
      if (/^CREATE TABLE/.test(sql)) return { results: [] };
      if (/SELECT name FROM editor_machines/.test(sql)) { const [cutoff, limit] = args; return { results: machines.filter((m) => m.last_used < cutoff && (m.stopped_at == null || m.stopped_at < m.last_used)).sort((a, b) => a.last_used - b.last_used).slice(0, limit).map((m) => ({ name: m.name })) }; }
      if (/SELECT id FROM render_jobs/.test(sql)) return { results: jobs.filter((j) => !["succeeded", "failed", "cancelled", "canceled"].includes(j.status)).map((j) => ({ id: j.id })) };
      if (/SELECT job FROM wrencut_reads/.test(sql)) return { results: reads.map((job) => ({ job })) };
      if (/UPDATE editor_machines SET stopped_at/.test(sql)) { const [at, name] = args; machines.find((m) => m.name === name).stopped_at = at; return { meta: { changes: 1 } }; }
      if (/DELETE FROM editor_machines/.test(sql)) { const [cutoff] = args; for (let i = machines.length - 1; i >= 0; i--) if (machines[i].last_used < cutoff) machines.splice(i, 1); return { meta: { changes: 1 } }; }
      if (/SELECT value FROM platform_settings/.test(sql)) return { value: settings.get("editor_watchdog") };
      if (/INSERT INTO platform_settings/.test(sql)) { settings.set("editor_watchdog", args[0]); return { meta: { changes: 1 } }; }
      throw new Error(`unexpected SQL: ${sql}`);
    };
    const statement = (args = []) => ({ bind: (...more) => statement(more), run: async () => run(args), all: async () => run(args), first: async () => run(args) });
    return statement();
  };
  return { prepare, settings };
}

function fakeMachines(running) {
  const knocked = [];
  const make = (name) => ({ fetch: async (url) => {
    knocked.push({ name, url: String(url) });
    assert.ok(String(url).startsWith("http://composer/__motionwren/sleep?idle="), "the watchdog only ever sends the knock");
    const was = running.has(name); running.delete(name);
    return Response.json(was ? { running: true, stopped: true, reason: "idle" } : { running: false, stopped: false, reason: "asleep" });
  } });
  return { knocked, binding: { getByName: make, idFromName: (x) => x, get: make } };
}

{
  const machines = [
    { name: "job-active", last_used: now - 120 * MIN, stopped_at: null },      // a film still being edited
    { name: "job-done", last_used: now - 120 * MIN, stopped_at: null },        // a finished film whose machine was left on
    { name: "wrencut-read1", last_used: now - 90 * MIN, stopped_at: null },    // a reading still in progress
    { name: "movement-abc", last_used: now - 50 * MIN, stopped_at: null },     // a photo read long done
    { name: "job-recent", last_used: now - 10 * MIN, stopped_at: null },       // used 10 minutes ago
    { name: "job-slept", last_used: now - 300 * MIN, stopped_at: now - 200 * MIN }, // already put to sleep
  ];
  const jobs = [{ id: "job-active", status: "stitching" }, { id: "job-done", status: "succeeded" }, { id: "job-recent", status: "succeeded" }];
  const db = fakeDb({ machines, jobs, reads: ["read1"] });
  const running = new Set(["job-active", "job-done", "wrencut-read1", "job-recent"]);
  const { knocked, binding } = fakeMachines(running);
  const result = await sweepIdleMachines({ DB: db, COMPOSER: binding }, IDLE_MS, now);
  const names = knocked.map((k) => k.name).sort();
  assert.deepEqual(names, ["job-done", "movement-abc"]);
  ok("the sweep knocks only on machines idle 45+ minutes that are not working on a film or reading");
  assert.ok(running.has("job-active") && running.has("wrencut-read1") && running.has("job-recent"));
  ok("a film mid-edit, a reading in progress and a recently used machine are never stopped");
  assert.equal(result.stopped, 1); assert.equal(machines.find((m) => m.name === "job-done").stopped_at, now);
  ok("the left-on machine is put to sleep and marked, so it is not knocked on again");
  assert.ok(knocked.every((k) => k.url.endsWith(`idle=${IDLE_MS}`)));
  ok("the knock carries the 45-minute idle rule");
  const again = fakeMachines(new Set());
  await sweepIdleMachines({ DB: db, COMPOSER: again.binding }, IDLE_MS, now + 10 * MIN);
  assert.ok(!again.knocked.some((k) => k.name === "job-done" || k.name === "movement-abc"));
  ok("a machine already put to sleep is left alone until it is used again");
  const state = JSON.parse(db.settings.get("editor_watchdog"));
  assert.equal(state.stoppedToday, 1); assert.ok(state.lastSweepAt);
  ok("the sweep records when it ran and how many it put to sleep today (shown on Finance)");
}
{ const result = await sweepIdleMachines({ DB: fakeDb({ machines: [], jobs: [] }) }, IDLE_MS, now); assert.deepEqual(result, { checked: 0, stopped: 0 }); ok("without the editing service bound, the sweep does nothing"); }
{ assert.equal(busyName("wrenprev-abc", new Set(["abc"])), true); assert.equal(busyName("job-1", new Set(["job-1"])), true); assert.equal(busyName("movement-x", new Set(["x"])), false); ok("machine names are matched to the work they belong to"); }
{ // 3 GiB on for 24 hours with 16 minutes of real processing and 8 GB of disk: about $0.70
  const day = containerDollars({ allocatedMemory: 3 * 1024 ** 3 * 86400, cpuTimeSec: 16 * 60, allocatedDisk: 8e9 * 86400 });
  assert.ok(Math.abs(day - (3 * 86400 * 0.0000025 + 960 * 0.00002 + 8 * 86400 * 0.00000007)) < 1e-9 && day > 0.69 && day < 0.72);
  ok(`the daily spend is priced at Cloudflare's rates (one 3 GiB machine left on all day: $${day.toFixed(2)})`); }
console.log(`${n} passed, 0 failed`);
