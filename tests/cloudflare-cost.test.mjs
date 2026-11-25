import assert from "node:assert/strict";
import { CATEGORIES, PLAN_DOLLARS, aiBillableNeurons, priceAll, priceCategory, r2Class } from "../app/cloudflare-cost.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const def = (key) => CATEGORIES.find((item) => item.key === key);

{ const all = priceAll({ requests: 2_000_000, d1Write: 1_000_000, r2A: 10_000 });
  assert.equal(all.overageCents, 0); assert.equal(all.totalCents, PLAN_DOLLARS * 100); ok("usage inside the plan costs only the plan"); }
{ const row = priceCategory(def("requests"), 12_000_000); // 2M beyond 10M at $0.30 per million
  assert.equal(row.overageCents, 60); assert.equal(row.share, 100); ok("requests beyond the included amount are priced per million"); }
{ const row = priceCategory(def("r2A"), 3_000_000); // 2M beyond 1M at $4.50 per million
  assert.equal(row.overageCents, 900); ok("saves and lists are priced as Class A"); }
{ const row = priceCategory(def("d1Storage"), 6.5); // 1.5 GB beyond 5 at $0.75
  assert.equal(row.overageCents, 112.5); ok("database storage beyond 5 GB is priced per GB"); }
{ assert.equal(aiBillableNeurons([9_000, 30_000, 10_000]), 20_000);
  assert.equal(priceCategory(def("ai"), 20_000).overageCents, 22); ok("AI neurons: the free 10,000 a day come off each day, then $0.011 per 1,000"); }
{ const row = priceCategory(def("containers"), 30); // 5 GiB-hours beyond 25
  assert.ok(Math.abs(row.overageCents - 4.5) < 0.01); ok("editing server memory beyond the included GiB-hours"); }
{ const row = priceCategory(def("cpu"), null); assert.equal(row.used, null); assert.equal(row.overageCents, 0);
  assert.equal(priceAll({ requests: 11_000_000 }).rows.find((item) => item.key === "cpu").used, null); ok("an unavailable category stays unknown and costs nothing"); }
{ assert.equal(r2Class("PutObject"), "A"); assert.equal(r2Class("GetObject"), "B"); assert.equal(r2Class("DeleteObject"), null); ok("R2 operations are sorted into Class A, Class B or free"); }
console.log(`${n} passed, 0 failed`);
