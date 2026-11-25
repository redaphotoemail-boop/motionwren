/* The Cloudflare bill on Finance: grouping by feature, splitting the editing machines, and the period projection. */
import assert from "node:assert/strict";
import { byFeature, machineFeature, productFeature, projection, splitMachines, periodAround, machineDollars, PLAN_CENTS } from "../app/cloudflare-bill.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const DAY = 86_400_000;

{ assert.equal(machineFeature("0b5c2d0e-1111-2222-3333-444455556666"), "film-editing"); assert.equal(machineFeature("movement-true-abc"), "photo-reading");
  assert.equal(machineFeature("wrencut-j1"), "wrencut-reading"); assert.equal(machineFeature("wrenprev-x"), "template-preview");
  assert.equal(machineFeature("music-sample-a-1"), "music"); assert.equal(machineFeature("build-check-1"), "checks"); ok("each editing machine is named to the feature it works for"); }
{ assert.equal(productFeature("Containers"), "machines"); assert.equal(productFeature("Workers AI"), "ai"); assert.equal(productFeature("R2"), "storage");
  assert.equal(productFeature("Images"), "images"); assert.equal(productFeature("Workers"), "website"); assert.equal(productFeature("D1"), "website"); assert.equal(productFeature("Durable Objects"), "website"); ok("Cloudflare services map to the feature they pay for"); }
{ const parts = splitMachines(4292, { "film-editing": 30, "photo-reading": 10, untagged: 60 });
  assert.equal(Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * 100) / 100, 4292); assert.equal(parts.untagged, 2575.2); assert.equal(parts["photo-reading"], 429.2);
  ok("the machines' billed cost is split by measured machine time and always adds up to the bill"); }
{ assert.deepEqual(splitMachines(100, {}), { untagged: 100 }); assert.deepEqual(splitMachines(0, { "film-editing": 5 }), {}); ok("with no measured time, machine cost shows as before tracking; with no cost, nothing"); }
{ const lines = byFeature([{ name: "Containers", cents: 1000 }, { name: "Workers AI", cents: 50 }, { name: "R2", cents: 20 }, { name: "Workers", cents: 5 }], { "film-editing": 3, "template-preview": 1 }, false);
  const by = Object.fromEntries(lines.map((line) => [line.key, line.cents]));
  assert.deepEqual(by, { "film-editing": 750, plan: PLAN_CENTS, "template-preview": 250, ai: 50, storage: 20, website: 5 });
  assert.equal(lines[0].key, "film-editing"); assert.ok(lines.find((line) => line.key === "film-editing").split); assert.ok(!lines.find((line) => line.key === "ai").split);
  const sum = lines.reduce((a, b) => a + b.cents, 0); assert.equal(sum, 1075 + PLAN_CENTS);
  ok("by feature: editing, previews, AI, storage, website and the plan add up to the whole bill, biggest first"); }
{ const start = Date.UTC(2026, 10, 3); const end = Date.UTC(2026, 11, 3); const now = start + 10 * DAY;
  const pace = projection(300, start, end, now); assert.equal(pace.soFarCents, 800); assert.equal(pace.projectedCents, 1400); assert.equal(pace.share, 33);
  ok("the bill so far is plan + usage, and the end-of-period figure follows the pace so far"); }
{ const p = periodAround(new Date(Date.UTC(2026, 10, 25)), 3); assert.equal(new Date(p.start).toISOString().slice(0, 10), "2026-11-03"); assert.equal(new Date(p.end).toISOString().slice(0, 10), "2026-12-03");
  const q = periodAround(new Date(Date.UTC(2026, 10, 2)), 3); assert.equal(new Date(q.start).toISOString().slice(0, 10), "2026-10-03"); ok("the billing period runs from the billing day to the same day next month"); }
{ assert.ok(Math.abs(machineDollars({ allocatedMemory: 3 * 1024 ** 3 * 3600 }) - 0.027) < 1e-9); ok("one 3 GB machine on for an hour costs 2.7 cents of memory"); }
console.log(`${n} passed, 0 failed`);
