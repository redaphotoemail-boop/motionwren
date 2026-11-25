/* The line guard (composer/lines.py, lines.mjs): Reda's rule of Nov 25 2026, straight lines never move.
   Makes synthetic scenes from one photo and checks the guard's verdicts. Needs python3 with OpenCV (as in the
   composer's container); skipped where OpenCV is missing. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
if (spawnSync("python3", ["-c", "import cv2"]).status !== 0) { console.log("SKIP line guard: OpenCV is not installed here"); process.exit(0); }
const dir = mkdtempSync(path.join(os.tmpdir(), "line-guard-"));
let n = 0; const ok = (name) => { console.log(`PASS ${name}`); n += 1; };
try {
  const made = spawnSync("python3", [path.join(here, "line-guard-scenes.py"), dir], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const guard = (clip, mode = "push") => JSON.parse(spawnSync("python3", [path.join(root, "composer/lines.py"), path.join(dir, `${clip}.mp4`), path.join(dir, "photo.jpg"), mode], { encoding: "utf8" }).stdout);
  assert.equal(guard("push_ok").held, true); ok("a clean push-in holds");
  assert.equal(guard("pull_reversed_ok").held, true); ok("a push-in played backwards (the closing pull-back) holds");
  assert.equal(guard("push_wobble").held, false); ok("a window frame shifting back and forth fails");
  assert.equal(guard("push_bend").held, false); ok("a bending line fails");
  const beyond = guard("pull_beyond"); assert.equal(beyond.held, false); assert.match(beyond.reason, /beyond the photo's edges/); ok("pulling back past the photo's edges fails");
  assert.equal(guard("arc_ok", "arc").held, true); ok("a gentle arc with smooth near/far drift holds");
  assert.equal(guard("arc_wobble", "arc").held, false); ok("an arc with a wobbling frame fails");
  const { photoClipArgs } = await import(path.join(root, "composer/server.mjs"));
  for (const move of ["push", "pull", "slide-left"]) {
    const out = path.join(dir, `still_${move}.mp4`);
    assert.equal(spawnSync("ffmpeg", photoClipArgs({ image: path.join(dir, "photo.jpg"), move, width: 1280, height: 720, fps: 24, seconds: 5, output: out })).status, 0);
    assert.equal(guard(`still_${move}`).held, true);
  }
  ok("every still-photo fallback move holds its lines");
  const { stabilizeArgs, STABILIZE_TRIM_PERCENT } = await import(path.join(root, "composer/lines.mjs"));
  const { transform } = stabilizeArgs("in.mp4", "t.trf", "out.mp4", 1920);
  const filter = transform[transform.indexOf("-vf") + 1];
  assert.equal(STABILIZE_TRIM_PERCENT, 2); assert.match(filter, /optzoom=0:zoom=2:maxshift=19:/); ok("stabilization trims a fixed 2% at most, its shifts capped inside that");
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`${n} passed`);
process.exit(0);
