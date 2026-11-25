import assert from "node:assert/strict";
import { FRAME_LOCK, TRUE_MOVE, focusFrom, truePicks, truePrompt } from "../app/api/_lib/true-to-photo.ts";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app/api/_lib/customer-production.ts", import.meta.url), "utf8");
const STATIC_LOCK = /export const STATIC_LOCK = "([^"]+)"/.exec(source)[1];
import { storyOrderIndexes } from "../app/wrencut-fit.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;

{ for (const phrase of Object.values(TRUE_MOVE)) { assert.match(phrase, /push-in/); assert.match(phrase, /very slow/); assert.match(phrase, /short distance/); assert.doesNotMatch(phrase, /pull|slide|reveal|orbit|pan/i); } ok("customer moves are only slow, short push-ins"); }
{ const prompt = truePrompt("left", STATIC_LOCK); assert.ok(prompt.startsWith(TRUE_MOVE.left)); assert.ok(prompt.includes(STATIC_LOCK)); assert.ok(prompt.endsWith(FRAME_LOCK)); ok("the baked lock is kept word for word, the frame lock follows it"); }
{ assert.match(FRAME_LOCK, /never reveals anything beyond the edges of the photo/); ok("the frame lock forbids space beyond the photo"); }
{ assert.equal(focusFrom(0.1), "left"); assert.equal(focusFrom(0.5), "center"); assert.equal(focusFrom(0.9), "right"); assert.equal(focusFrom(null), "center"); assert.equal(focusFrom(undefined), "center"); assert.equal(focusFrom(Number.NaN), "center"); ok("the push leans toward the photo's focal point, centred when unsure"); }
{ assert.deepEqual(storyOrderIndexes(["kitchen", "exterior", "bedroom", "living"]), [1, 3, 0, 2]); ok("walkthrough order: exterior, living, kitchen, bedroom"); }
{ assert.deepEqual(storyOrderIndexes([null, null, "kitchen", null]), [0, 1, 2, 3]); ok("too few rooms named: the customer's order is kept"); }
{ const picks = truePicks({ order: [1, 0], focus: ["right", "center"], rooms: ["kitchen", "exterior"], reader: "cloudflare", ordered: true, costCents: 1, note: "", at: 0 }); assert.equal(picks.length, 2); assert.ok(picks.every((pick) => pick.move === "push")); assert.match(picks[0].why, /^exterior/); assert.match(picks[1].why, /kitchen.*leaning right/); ok("the recorded plan matches the order and the rooms"); }
{ assert.ok(STATIC_LOCK.startsWith("Create an extremely realistic professional real-estate shot.")); assert.ok(source.includes('"a slow stabilized push-in",')); assert.ok(source.includes("${STATIC_LOCK}") || source.includes("truePrompt(")); ok("the baked lock and movement list are unchanged"); }
console.log(`${n} passed`);
