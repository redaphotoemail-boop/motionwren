import assert from "node:assert/strict";
import { fixEngine } from "../app/fix-engine.ts";
// A film is made at most four times: the first, then the same engine, then another, then Wan 3.0. Never Runway.
assert.equal(fixEngine("h3lite", 1), "h3lite");
assert.equal(fixEngine("h3lite", 2), "h3");
assert.equal(fixEngine("h3lite", 3), "wan3");
assert.equal(fixEngine("wan3", 1), "wan3");
assert.equal(fixEngine("wan3", 2), "h3");
assert.equal(fixEngine("wan3", 3), "wan3");
assert.equal(fixEngine("h3", 2), "wan3");
for (const first of ["kling3", "runway4turbo", "h3", "h3lite", "wan3"]) for (const round of [2, 3]) assert.ok(!/^runway/.test(fixEngine(first, round)));
console.log("PASS fix engine ladder");
