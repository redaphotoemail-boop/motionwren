/* The client's film editor (Reda, Nov 25 2026): scene order and kept takes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_TAKES, sceneOrder, takeFile } from "../app/scene-order.ts";

let n = 0; const ok = (name) => { console.log(`PASS ${name}`); n += 1; };
assert.deepEqual(sceneOrder([2, 0, 1], 3), [2, 0, 1]); ok("a new order lists every scene once");
assert.equal(sceneOrder([0, 1, 2], 3), null); ok("the order the film was made in needs no order");
assert.equal(sceneOrder([0, 0, 1], 3), null); assert.equal(sceneOrder([0, 1], 3), null); assert.equal(sceneOrder([0, 1, 3], 3), null); assert.equal(sceneOrder("0,1,2", 3), null); ok("a repeated, missing or unknown scene is refused");
assert.equal(takeFile(0, 0), "take-01-1.mp4"); assert.equal(takeFile(11, 5), "take-12-6.mp4"); assert.ok(MAX_TAKES >= 3); ok("earlier versions are stored as take-NN-K.mp4");
const frames = readFileSync(new URL("../app/api/job-frames/[jobId]/[file]/route.ts", import.meta.url), "utf8");
assert.ok(/take-\\d\{2\}-\\d\{1,2\}\\.mp4/.test(frames)); ok("the film's file route serves earlier versions");
const route = readFileSync(new URL("../app/api/projects/[id]/edit/route.ts", import.meta.url), "utf8");
assert.ok(route.includes("requireAccount(env)") && route.includes("owner_id = ?") && !route.includes("requireAdmin")); ok("the client's editor checks the film is theirs");
assert.ok(route.includes('row.kind !== "customer-series"') && route.includes("customerRemakes") && route.includes("status: 402")); ok("scene remakes stop at the number included with the film");
assert.ok(!route.includes("body.template") && !route.includes("body.titles") && !route.includes("body.sfx") && !route.includes("body.useScenes")); ok("clients change only cards, order, frame, music, voice, remakes and takes");
const files = readFileSync(new URL("../app/api/projects/[id]/film/[file]/route.ts", import.meta.url), "utf8");
assert.ok(files.includes("owner_id = ?") && files.includes("(scene-\\d{2}\\.jpg|out-\\d{2}\\.mp4|take-\\d{2}-\\d{1,2}\\.mp4)")); ok("a client can open only their own film's scenes, photos and earlier versions");
console.log(`${n} passed`);
