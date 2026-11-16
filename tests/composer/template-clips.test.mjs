/* Template films from already-made clips (Task 1): the recipe runs on saved
   video clips, one per input slot, instead of photos. The composer must use
   THOSE clips — each scene's footage comes from its slot's clip, at the
   planner's start offset — and the film comes out at the recipe's size and
   length with audio. Run with CLIPS_DIR to use real saved clips (in the
   recipe's inputs order) instead of the generated ones:
     CLIPS_DIR=~/workspace/verify-house-calling/inputs node tests/composer/template-clips.test.mjs */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRADE_TABLE, makeCallBanner, parseTemplateRecipe, planTemplateScenes, prepareTemplateInputs, templateDuration, templateEditArgs, templateShotArgs } from "../../composer/template-recipe.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); } else { fail += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-clips-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const dur = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
const probe = (file) => { const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-show_entries", "format=duration", "-of", "json", file]).toString()); return { width: out.streams[0].width, height: out.streams[0].height, duration: Number(out.format.duration) }; };
const W = 1080, H = 1920, FPS = 30;

const recipe = parseTemplateRecipe(fs.readFileSync(new URL("../../composer/templates/house-calling-v1.json", import.meta.url), "utf8"));
const slots = recipe.inputs.map((input) => input.slot);

// The clips: real saved ones when CLIPS_DIR is set, else generated — one per
// slot, each a distinct colour with a white bar sweeping across, so a scene
// can be told apart from every other slot's clip by its frames.
const clipsDir = process.env.CLIPS_DIR || "";
let files;
if (clipsDir) {
  files = slots.map((slot) => path.join(clipsDir, `${slot}.mp4`));
  for (const file of files) if (!fs.existsSync(file)) { console.log(`FAIL missing clip ${file}`); process.exit(1); }
  console.log(`using real clips from ${clipsDir}`);
} else {
  const hues = { exterior_day: "c03028", exterior_night: "2040c0", exterior_day_low: "28a040", dining: "c0a020", dining_alt: "20a0c0", kitchen: "c020a0", living: "e07020" };
  files = slots.map((slot) => {
    const out = path.join(dir, `${slot}.mp4`);
    ff(["-f", "lavfi", "-i", `color=c=0x${hues[slot]}:s=720x1280:r=30:d=8`, "-vf", "drawbox=x='(iw-120)*t/8':y=200:w=120:h=120:color=white:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    return out;
  });
  console.log("using generated clips (distinct colour + sweeping bar per slot)");
}
const durations = files.map((file) => probe(file).duration);
check("one clip per input slot", files.length === slots.length, `${files.length} clips for ${slots.length} slots`);
check("every clip is vertical video", files.every((file) => { const p = probe(file); return p.height > p.width; }), files.map((file) => { const p = probe(file); return `${p.width}x${p.height}`; }).join(", "));

// The composer passes video inputs through untouched (only stills are looped).
const prepared = await prepareTemplateInputs({ recipe, files, durations, width: W, height: H, fps: FPS, dir });
check("video inputs pass through untouched", prepared.files.every((file, i) => file === files[i]) && prepared.durations.every((d, i) => Math.abs(d - durations[i]) < 0.01), prepared.files.map((f) => path.basename(f)).join(","));
const picks = planTemplateScenes(recipe, prepared.durations);
check("scenes map to their slots in order", picks.map((p) => p.clip).join(",") === "0,1,2,1,3,4,5,6", picks.map((p) => p.clip).join(","));

// Render every scene, then join as the recipe says, with music.
const banner = await makeCallBanner({ title: "The Perfect House", subtitle: "Mobile", width: W, height: H, dir });
const sceneFiles = [];
for (let i = 0; i < picks.length; i += 1) {
  const pick = picks[i];
  const out = path.join(dir, `scene-${String(i + 1).padStart(2, "0")}.mp4`);
  ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe, scene: pick.scene, input: prepared.files[pick.clip], output: out, width: W, height: H, fps: FPS, start: pick.start, bannerFile: pick.scene.overlay ? banner : null, available: prepared.durations[pick.clip] - pick.start })]);
  sceneFiles.push(out);
}
let music = path.join(dir, "music.mp3");
if (clipsDir && fs.existsSync(path.join(clipsDir, "..", "music.mp3"))) music = path.join(clipsDir, "..", "music.mp3");
else ff(["-f", "lavfi", "-i", "sine=frequency=110:duration=16", "-c:a", "libmp3lame", "-q:a", "4", music]);
const film = path.join(dir, "film.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateEditArgs({ recipe, sceneFiles, music, width: W, height: H, fps: FPS, duration: templateDuration(recipe), output: film })]);
const filmProbe = probe(film);
check("the film is the recipe's length", Math.abs(filmProbe.duration - templateDuration(recipe)) < 0.15, `${filmProbe.duration.toFixed(2)}s vs ${templateDuration(recipe)}s`);
check("the film is the recipe's size", filmProbe.width === W && filmProbe.height === H, `${filmProbe.width}x${filmProbe.height}`);
const streams = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", film]).toString()).streams.map((s) => s.codec_type);
check("the film has audio", streams.includes("audio"), streams.join(","));

// Each scene's footage is its own slot's clip: sample frames from the film
// at three points in the scene and compare them, pixel by pixel, with the
// same moments of the expected clip — and with every other slot's clip.
// The expected clip must win by a clear margin at every scene.
// The comparison is graded-to-graded: the film's frame carries the scene's
// grade (eq + LUT), so each clip frame is put through the same grade first.
// Comparing a graded frame to a raw clip fails on near-identical hues — the
// grade's warmth shift can land a scene closer to a different clip's raw
// colour than to its own (the saved clips are static, near-identical warm
// tans, and only their burned-in label tells them apart).
const LUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../composer/luts");
const gradeFor = (scene) => ((recipe.night_slots || []).includes(scene.id) || (recipe.night_slots || []).includes(scene.input)) ? "night_warm_windows" : scene.grade;
const frame = (file, t, w = 160, h = 90) => new Uint8Array(execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 }));
const gradedFrame = (file, t, gradeName, w = 160, h = 90) => {
  const grade = GRADE_TABLE[gradeName];
  if (!grade) return frame(file, t, w, h);
  const lut = path.join(LUT_DIR, grade.lut);
  return new Uint8Array(execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h},eq=${grade.eq},lut3d=file='${lut}'`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 }));
};
const meanAbsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; };
let worstMargin = Infinity, worstScene = "";
for (let i = 0; i < picks.length; i += 1) {
  const pick = picks[i], scene = pick.scene;
  const gradeName = gradeFor(scene);
  const diffs = [];
  for (let j = 0; j < files.length; j += 1) {
    let total = 0, n = 0;
    for (const f of [0.25, 0.5, 0.75]) {
      const outFrame = frame(film, scene.start_s + scene.duration_s * f);
      const srcTime = Math.min(picks[i].start + scene.duration_s * f, durations[j] - 0.1);
      total += meanAbsDiff(outFrame, gradedFrame(files[j], srcTime, gradeName)); n += 1;
    }
    diffs.push(total / n);
  }
  const expected = diffs[pick.clip];
  const bestOther = Math.min(...diffs.filter((_, j) => j !== pick.clip));
  const margin = bestOther / Math.max(expected, 0.01);
  if (margin < worstMargin) { worstMargin = margin; worstScene = scene.id; }
  check(`scene ${scene.id} is its own clip's footage (${slots[pick.clip]})`, expected < bestOther * 0.7, `diff ${expected.toFixed(1)} vs next-best ${bestOther.toFixed(1)} (${slots[diffs.indexOf(bestOther)]})`);
}
console.log(`worst source margin: ${worstMargin.toFixed(2)}x at ${worstScene}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
