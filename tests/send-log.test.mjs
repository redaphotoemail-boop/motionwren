import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transform } from "esbuild";
const dir = mkdtempSync(join(tmpdir(), "sl-"));
writeFileSync(join(dir, "sl.mjs"), (await transform(readFileSync("app/studio/send-log.ts", "utf8"), { loader: "ts", format: "esm" })).code);
const { explainSend } = await import(join(dir, "sl.mjs"));
const MB = 1_048_576;
const base = { startedAt: 1, sizes: [6 * MB, 5 * MB], hiddenMs: 0, hiddenTimes: 0, events: [], sent: 0 };
// no record on this phone: says so, claims no cause
assert.match(explainSend(null, 7).verdict, /no record/);
// page left for a minute while sending
assert.match(explainSend({ ...base, hiddenMs: 70_000, hiddenTimes: 1, events: [{ scene: 1, attempt: 1, bytes: 6 * MB, ms: 70000, outcome: "dropped" }] }, 7).verdict, /out of view for 70 s/);
// a photo that took over two minutes
const slow = explainSend({ ...base, events: [{ scene: 1, attempt: 1, bytes: 6 * MB, ms: 120000, outcome: "timeout" }, { scene: 1, attempt: 2, bytes: 6 * MB, ms: 120000, outcome: "timeout" }] }, 7);
assert.match(slow.verdict, /Photo 1 \(6\.0 MB\) did not finish within 2 minutes/); assert.match(slow.facts.join("|"), /2 send attempts/);
// refused by the server
assert.match(explainSend({ ...base, events: [{ scene: 2, attempt: 1, bytes: MB, ms: 900, outcome: "refused", detail: "Photo too large" }] }, 7).verdict, /refused photo 2: Photo too large/);
// nothing was even attempted
assert.match(explainSend({ ...base }, 7).verdict, /never started/);
// everything reported sent but the server disagrees
assert.match(explainSend({ ...base, sent: 7, events: [{ scene: 1, attempt: 1, bytes: MB, ms: 900, outcome: "ok" }] }, 7).verdict, /reported every photo as sent/);
console.log("send-log: ok");
