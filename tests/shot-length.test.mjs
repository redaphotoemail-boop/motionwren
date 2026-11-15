// A template shot must be exactly as long as the template says, whatever its speed ramp does: the join places every cut by those lengths,
// and a short shot made the film freeze (video stopped while the music played on).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { shotArgs } from "../composer/wrencut.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "shot-"));
const clip = path.join(dir, "clip.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=5", "-pix_fmt", "yuv420p", clip]);
const recipe = (slot) => ({ version: 1, duration: slot.dur, fps: 24, aspect: "vertical", slots: [slot], joins: [] });
const cases = [
  ["slow-motion ramp", { dur: 2.42, zoom: [1, 1], pan: [0, 0], speed: [[0, 3.5], [0.083, 3.5], [0.31, 0.3], [0.835, 0.3], [1, 1]] }],
  ["shot longer than its clip", { dur: 6, zoom: [1, 1], pan: [0, 0], speed: [[0, 1], [1, 2]] }],
  ["plain shot longer than its clip", { dur: 6, zoom: [1, 1], pan: [0, 0] }],
];
for (const [name, slot] of cases) {
  const output = path.join(dir, "shot.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...shotArgs({ recipe: recipe(slot), index: 0, input: clip, output, width: 270, height: 480, fps: 24, start: 0, available: 5, strength: 1 })]);
  const length = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output]).toString());
  assert.ok(Math.abs(length - (slot.dur + 0.2)) < 0.1, `${name}: shot is ${length}s, expected ${slot.dur + 0.2}s`);
  console.log(`PASS ${name}`);
}
