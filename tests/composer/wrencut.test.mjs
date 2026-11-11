/* WrenCut on the real ffmpeg: a recipe (shots, joins, zoom, grade) renders to its
   own length; a flash join brightens the join; the analyzer reads a synthetic
   reference back into a recipe with the same number of shots. */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { editArgs } from "../../composer/server.mjs";
import { analyzeVideo, recipeDuration, validRecipe } from "../../composer/wrencut.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "wrencut-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const dur = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

const recipe = {
  version: 1, duration: 0, fps: 24, aspect: "9:16",
  slots: [{ dur: 2, zoom: [1, 1.25], pan: [0, 0] }, { dur: 1.5, zoom: [1, 1], pan: [0, 0] }, { dur: 1.5, zoom: [1.1, 1], pan: [0, 0] }],
  joins: [{ type: "cut", dur: 0.04 }, { type: "flash", dur: 0.16 }],
  grade: { warmth: 0.5, saturation: 1.05 },
};
recipe.duration = recipeDuration(recipe);
check("the recipe is valid", validRecipe(recipe) === "", validRecipe(recipe));

const clips = [0x303030, 0x606060, 0x909090].map((c, n) => { const file = path.join(dir, `c${n}.mp4`); ff(["-f", "lavfi", "-i", `color=c=0x${c.toString(16)}:s=360x640:r=24:d=4`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]); return file; });
const output = path.join(dir, "out.mp4");
ff(editArgs({ clips, width: 360, height: 640, fps: 24, crossfade: 0, duration: recipe.duration, sceneSeconds: 2, output, recipe, strength: 1 }));
check("the film is the recipe's length", Math.abs(dur(output) - recipe.duration) < 0.3, `${dur(output).toFixed(2)} vs ${recipe.duration.toFixed(2)}`);

// Reference: three clearly different shots, read back into a recipe.
const refParts = ["testsrc2", "mandelbrot", "life=mold=10:ratio=0.1:death_color=#202040:life_color=#ffcc88"].map((src, n) => { const file = path.join(dir, `r${n}.mp4`); ff(["-f", "lavfi", "-i", `${src}${src.includes("=") ? ":" : "="}s=360x640:r=30`, "-t", "1.5", "-pix_fmt", "yuv420p", file]); return file; });
const ref = path.join(dir, "ref.mp4");
ff([...refParts.flatMap((f) => ["-i", f]), "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-pix_fmt", "yuv420p", ref]);
const read = await analyzeVideo(ref, { duration: 4.5, fps: 30, width: 360, height: 640 });
check("the analyzer finds the three shots", read.slots.length === 3, `${read.slots.length} shots`);
check("the analyzer's recipe is valid", validRecipe(read) === "", validRecipe(read));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
