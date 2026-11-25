import assert from "node:assert/strict";
import { FRAME_LOCK, TRUE_ARC, TRUE_GLIDE, TRUE_MOVE, focusFrom, planMoves, truePicks, truePrompt } from "../app/api/_lib/true-to-photo.ts";
import { isSidewaysMove } from "../app/api/_lib/production.ts";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app/api/_lib/customer-production.ts", import.meta.url), "utf8");
const STATIC_LOCK = /export const STATIC_LOCK = "([^"]+)"/.exec(source)[1];
import { storyOrderIndexes } from "../app/wrencut-fit.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;

{ for (const phrase of [...Object.values(TRUE_MOVE), ...Object.values(TRUE_ARC), ...Object.values(TRUE_GLIDE)]) { assert.match(phrase, /push-in/); assert.match(phrase, /very slow/); assert.match(phrase, /short distance/); assert.match(phrase, /softly at one slow, steady speed/); assert.doesNotMatch(phrase, /pull|reveal|orbit|\bpan|lateral slide/i); assert.equal(isSidewaysMove(phrase), false); } ok("every customer move pushes in a little, slowly and eased, and is never slowed in the edit"); }
{ const prompt = truePrompt("left", STATIC_LOCK); assert.ok(prompt.startsWith(TRUE_MOVE.left)); assert.ok(prompt.includes(STATIC_LOCK)); assert.ok(prompt.endsWith(FRAME_LOCK)); ok("the baked lock is kept word for word, the frame lock follows it"); }
{ assert.match(FRAME_LOCK, /never reveals anything beyond the edges of the photo/); ok("the frame lock forbids space beyond the photo"); }
{ assert.equal(focusFrom(0.1), "left"); assert.equal(focusFrom(0.5), "center"); assert.equal(focusFrom(0.9), "right"); assert.equal(focusFrom(null), "center"); assert.equal(focusFrom(undefined), "center"); assert.equal(focusFrom(Number.NaN), "center"); ok("the push leans toward the photo's focal point, centred when unsure"); }
{ assert.deepEqual(storyOrderIndexes(["kitchen", "exterior", "bedroom", "living"]), [1, 3, 0, 2]); ok("walkthrough order: exterior, living, kitchen, bedroom"); }
{ assert.deepEqual(storyOrderIndexes([null, null, "kitchen", null]), [0, 1, 2, 3]); ok("too few rooms named: the customer's order is kept"); }
{ const picks = truePicks({ order: [1, 0], focus: ["right", "center"], shapes: [1.5, 1.5], rooms: ["kitchen", "exterior"], reader: "cloudflare", ordered: true, costCents: 1, note: "", at: 0 }); assert.equal(picks.length, 2); assert.ok(picks.every((pick) => pick.move === "push")); assert.match(picks[0].why, /^exterior/); assert.match(picks[1].why, /kitchen.*leaning right/); ok("the recorded plan matches the order and the rooms"); }
{ const plan = { focus: ["center", "center", "left", "center", "center", "center"], shapes: [1.5, 1.5, 1.5, 1.9, 1.5, 1.5], rooms: ["exterior", "living", "kitchen", "outdoor", "bedroom", "outdoor"] };
  const moves = planMoves(plan, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(moves.map((m) => m.kind), ["push", "arc", "push", "glide", "push", "close"]);
  assert.equal(moves[5].reverse, true); assert.equal(moves[5].still, "pull"); assert.ok(moves.slice(0, 5).every((m) => !m.reverse));
  assert.equal(moves[3].lean, "left"); assert.equal(moves[3].still, "slide-left");
  assert.ok(moves.every((m) => m.guard === (m.kind === "arc" || m.kind === "glide" ? "arc" : "push")));
  ok("move mix: push to open, arcs between, one glide across a wide view, pull-back to close"); }
{ const plan = { focus: ["center", "center", "center", "center"], shapes: [2, 2, 2, 2], rooms: ["outdoor", "outdoor", "outdoor", "outdoor"] };
  const moves = planMoves(plan, [0, 1, 2, 3]); assert.ok(!moves.some((m) => m.kind === "glide")); assert.equal(moves[3].kind, "close"); ok("no glide in a film of fewer than five scenes"); }
{ const plan = { focus: ["center", "right", "center", "center"], shapes: [1.5, 1.5, 1.5, 1.5], rooms: [null, null, null, null] };
  const moves = planMoves(plan, [0, 1, 2, 3]); assert.equal(moves[1].lean, "right"); assert.equal(moves[2].lean, "right"); ok("matched cuts: a scene keeps going the way the one before it went"); }
{ const close = planMoves({ focus: ["center", "center", "center"], shapes: [1, 1, 1], rooms: [null, null, null] }, [0, 1, 2])[2]; assert.ok(truePrompt(close, STATIC_LOCK).startsWith(TRUE_MOVE.center)); ok("the closing pull-back is asked of the engine as a push-in (played backwards in the edit)"); }
{ const arc = planMoves({ focus: ["center", "left", "center"], shapes: [1, 1, 1], rooms: [null, null, null] }, [0, 1, 2])[1]; assert.ok(truePrompt(arc, STATIC_LOCK).startsWith(TRUE_ARC.left)); ok("an arc goes toward the photo's focal point"); }
{ assert.ok(STATIC_LOCK.startsWith("Create an extremely realistic professional real-estate shot.")); assert.ok(source.includes('"a slow stabilized push-in",')); assert.ok(source.includes("${STATIC_LOCK}") || source.includes("truePrompt(")); assert.match(FRAME_LOCK, /stay perfectly straight and still/); ok("the baked lock and movement list are unchanged"); }
console.log(`${n} passed`);
