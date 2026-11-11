/* A template's warm grade, on the real ffmpeg: a neutral grey film gets warmer
   (red up, blue down); without the grade it stays neutral. Hard cuts still join. */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { editArgs } from "../../composer/server.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "grade-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const clips = [1, 2].map((n) => { const file = path.join(dir, `c${n}.mp4`); ff(["-f", "lavfi", "-i", "color=c=0x808080:s=320x180:r=24:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]); return file; });
const make = (grade, name) => { const output = path.join(dir, name); ff(editArgs({ clips, width: 320, height: 180, fps: 24, crossfade: 0, duration: 4, sceneSeconds: 2, output, grade })); return output; };
const mean = (file) => { const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", file, "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]); return [raw[0], raw[1], raw[2]]; };
const plain = mean(make(undefined, "plain.mp4")), warm = mean(make("warm", "warm.mp4"));
check("without a grade the picture stays neutral", Math.abs(plain[0] - plain[2]) <= 6, `rgb ${plain}`);
check("the warm grade lifts red over blue", warm[0] - warm[2] >= 8, `rgb ${warm}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
