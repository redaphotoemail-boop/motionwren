import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transform } from "esbuild";
const dir = mkdtempSync(join(tmpdir(), "fc-"));
const out = (await transform(readFileSync("app/frame-crop.ts", "utf8"), { loader: "ts", format: "esm" })).code;
writeFileSync(join(dir, "fc.mjs"), out);
const { frameCrop } = await import(join(dir, "fc.mjs"));
// 4:3 photo into 16:9: height trimmed, three quarters from the top, the bottom edge's share kept
const a = frameCrop(4000, 3000, 16 / 9);
assert.equal(Math.round(a.sh), 2250); assert.equal(Math.round(a.sy), 563); assert.equal(Math.round(a.sy + a.sh), 2813);
assert.ok(a.sy + a.sh > 3000 - 750 * 0.3, "the floor must keep most of its share");
// landscape photo into vertical: sides trimmed, centred, nothing off the top or bottom
const b = frameCrop(6000, 4000, 9 / 16);
assert.equal(b.sy, 0); assert.equal(Math.round(b.sh), 4000); assert.equal(Math.round(b.sx), Math.round((6000 - b.sw) / 2));
// already the right shape: nothing lost
const c = frameCrop(1920, 1080, 16 / 9);
assert.ok(c.lostShare < 0.001);
console.log("frame-crop: ok");
