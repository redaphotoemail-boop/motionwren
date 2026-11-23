import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transform } from "esbuild";
const dir = mkdtempSync(join(tmpdir(), "os-"));
for (const [file, out] of [["app/original-shape.ts", "shape.mjs"], ["app/engine-catalog.ts", "catalog.mjs"], ["app/frame-crop.ts", "fc.mjs"]]) {
  writeFileSync(join(dir, out), (await transform(readFileSync(file, "utf8"), { loader: "ts", format: "esm" })).code);
}
const { filmShape, cleanShape, shapeSize, shapeLabel } = await import(join(dir, "shape.mjs"));
const { engineKeepsPhotoShape, studioEngines } = await import(join(dir, "catalog.mjs"));
const { frameCrop } = await import(join(dir, "fc.mjs"));

// the film takes the most common shape among its photos
assert.equal(filmShape([6000 / 4000, 6000 / 4000, 4000 / 6000]), 1.5);
assert.equal(filmShape([4032 / 3024, 4032 / 3024, 6000 / 4000]), 1.3333);
// a photo a hair off a standard shape counts as that shape (a 6000x4010 crop of a 3:2 camera)
assert.equal(filmShape([6000 / 4010]), 1.5);
// a tie goes to the first photo; no photos falls back to 16:9
assert.equal(filmShape([1.5, 4 / 3]), 1.5);
assert.ok(Math.abs(filmShape([]) - 16 / 9) < 1e-9);
// out-of-range shapes are held inside what the engines take (1:2.5 to 2.5:1)
assert.equal(filmShape([5]), 2.5); assert.equal(filmShape([0.1]), 0.5);
// a shape from the browser is checked
assert.equal(cleanShape("1.5"), 1.5); assert.equal(cleanShape(0), null); assert.equal(cleanShape("x"), null); assert.equal(cleanShape(9), null);
// sizes are even numbers the composer accepts
for (const [ratio, height] of [[1.5, 1080], [1.5, 720], [4 / 3, 1080], [1.3333, 720], [0.6667, 1080], [2.5, 1080]]) {
  const size = shapeSize(ratio, height);
  assert.ok(size.width % 2 === 0 && size.height % 2 === 0 && size.width >= 240 && size.width <= 4096, `${ratio} ${height}`);
  assert.ok(Math.abs(size.width / size.height / ratio - 1) < 0.002, `${ratio} ${height}`);
}
assert.deepEqual(shapeSize(1.5, 1080), { width: 1620, height: 1080 });
assert.equal(shapeLabel(1.5), "3:2"); assert.equal(shapeLabel(1.3333), "4:3"); assert.equal(shapeLabel(1.9), "1.90:1");

// a photo already at the film's shape is not cut at all; a photo of another shape is cut the way new films always are (floor kept)
assert.ok(frameCrop(6000, 4000, 1.5).lostShare < 1e-9);
const odd = frameCrop(4000, 3000, 1.5); assert.ok(odd.sy > 0 && odd.sy + odd.sh > 3000 - (3000 - odd.sh) * 0.3);

// which engines can make the film at the photo's own shape: only those whose provider ignores the frame size for a photo, or is sent none
const keeps = studioEngines.filter((engine) => engineKeepsPhotoShape(engine.key)).map((engine) => engine.key).sort();
assert.deepEqual(keeps, ["h3", "h3lite", "hailuo23", "kling3", "vidu3turbo", "wan25", "wan27", "wan3"]);
for (const key of ["veo31Lite", "geminiOmni", "luma", "runway4turbo", "runway45", "photo", "photo2", "photo3"]) assert.equal(engineKeepsPhotoShape(key), false, key);
// the composer's crop: centred without an anchor (films made before this are unchanged), floor-keeping with one
const { coverCrop } = await import(join(process.cwd(), "composer/wrencut.mjs"));
assert.equal(coverCrop(1920, 1080), "crop=1920:1080");
assert.equal(coverCrop(1920, 1080, 0.5), "crop=1920:1080");
assert.equal(coverCrop(1920, 1080, 0.75), "crop=1920:1080:(in_w-1920)/2:(in_h-1080)*0.750");
console.log("original-shape: ok");
