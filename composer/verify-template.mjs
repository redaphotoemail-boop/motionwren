/* Verify a template recipe against its render (spec §5a), plus the
   determinism half of §5b.1.

   Usage:
     node composer/verify-template.mjs --recipe composer/templates/house-calling-v1.json \
       --inputs <dir of inputs, one per input slot, named <slot>.mp4 or <slot>.jpg/.png/.webp> \
       --music <file.mp3> [--voiceover <file.mp3>] \
       --out <dir> [--size 1080x1920] [--fps 30] [--determinism]

   It renders the template with FIXED test inputs, then checks each §5a
   item pass/fail from the frames themselves — no eyeballing, no OCR
   (the container ships tesseract, but this box may not; caption text
   exactness is checked at the filter-graph level by the unit tests, and
   the frames here are checked for the caption being on screen in the
   right window). Prints one PASS/FAIL line per check plus a JSON
   report, and exits 1 when any check fails.

   Measurement notes (learned the hard way on tour-flow-v1):
   - Captions are sharp white text drawn AFTER the ramp, so they inflate
     whole-frame sharpness whenever they are on screen. Caption checks
     therefore use the Laplacian variance restricted to the caption band
     (band sharpness), which separates cleanly (4-22x) even on bright
     white rooms where a brightness measure cannot see the text.
   - The same confound applies to blur: film sharpness cannot measure
     the ramp's blur while a caption is up. Blur is measured on a
     separate calibration render from a detailed still with no captions.
   - The speed bar is a solid grey frame whose brightness rises linearly
     with source time (geq), measured by regression — a swept gradient
     saturates, which silently halved every measured speed.
   - A whip's blur is measured against the sharper of two neighbours,
     because a ramped scene's fast exit is blurred by the ramp itself.

   What it cannot check: that a caption's letters are exactly right
   (needs OCR — see above), and that a grade "feels" right on real
   footage (it checks channel balance and brightness only, per scene). */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTemplateRecipe, planTemplateScenes, prepareTemplateInputs, rampSourceSeconds, sampleRampCurve, stillToClip, templateDuration, templateShotArgs, templateEditArgs, templateQualityCheck, makeCallBanner, DUCK_FILTER } from "./template-recipe.mjs";
import { sampleFrames, sharpness } from "./qc.mjs";

const args = {};
{ // Both `--key=value` and `--key value` work; a bare `--flag` is true.
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 2) { args[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { args[key] = next; i += 1; }
    else args[key] = true;
  }
}
const fail = (message) => { console.error(`verify: ${message}`); process.exit(2); };
if (!args.recipe || !args.inputs || !args.out) fail("need --recipe, --inputs and --out");
const recipe = parseTemplateRecipe(fs.readFileSync(args.recipe, "utf8"));
const [width, height] = String(args.size || recipe.resolution).split("x").map(Number);
const fps = Number(args.fps || recipe.fps);
const outDir = path.resolve(String(args.out));
fs.mkdirSync(outDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-template-"));
const results = [];
const check = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${detail}`); };

const run = (command, argv, { timeoutMs = 20 * 60 * 1000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, argv, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (chunk) => { err += chunk; if (err.length > 5000) err = err.slice(-4000); });
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} took too long.`)); }, timeoutMs);
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`${command} failed (${code}): ${err.slice(-600)}`)); });
});
const ffprobe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", file]).toString());
const durOf = (file) => { const info = ffprobe(file); return Number(info.format?.duration) || 0; };

/* ---------- render ---------- */

async function renderOnce(tag) {
  const work = path.join(dir, tag);
  fs.mkdirSync(work, { recursive: true });
  // An input slot is a video clip (.mp4) or a still photo (.jpg/.png/.webp).
  const clipFiles = recipe.inputs.map((input) => {
    for (const ext of ["mp4", "jpg", "jpeg", "png", "webp"]) {
      const file = path.join(String(args.inputs), `${input.slot}.${ext}`);
      if (fs.existsSync(file)) return file;
    }
    fail(`missing input for slot "${input.slot}" in ${String(args.inputs)} (want ${input.slot}.mp4/.jpg/.png/.webp)`);
  });
  const durations = clipFiles.map(durOf);
  // Still photos are looped into clips of the length the recipe needs
  // before planning, so the planner sees real durations.
  const prepared = await prepareTemplateInputs({ recipe, files: clipFiles, durations, width, height, fps, dir: work });
  const picks = planTemplateScenes(recipe, prepared.durations);
  let bannerFile = null;
  const bannerScene = recipe.scenes.find((s) => s.overlay?.type === "call_banner");
  if (bannerScene) bannerFile = await makeCallBanner({ title: bannerScene.overlay.title, subtitle: bannerScene.overlay.subtitle, width, height, dir: work });
  const sceneFiles = [];
  for (let i = 0; i < picks.length; i += 1) {
    const pick = picks[i];
    const out = path.join(work, `scene-${String(i + 1).padStart(2, "0")}.mp4`);
    const input = prepared.files[pick.clip];
    const shotArgs = templateShotArgs({ recipe, scene: pick.scene, input, output: out, width, height, fps, start: pick.start, bannerFile: pick.scene.overlay ? bannerFile : null, available: prepared.durations[pick.clip] - pick.start });
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...shotArgs]);
    sceneFiles.push(out);
  }
  const film = path.join(work, "film.mp4");
  const music = args.music ? path.resolve(String(args.music)) : null;
  const voiceover = args.voiceover ? path.resolve(String(args.voiceover)) : null;
  if (music && !fs.existsSync(music)) fail(`music file not found: ${music}`);
  if (voiceover && !fs.existsSync(voiceover)) fail(`voiceover file not found: ${voiceover}`);
  const editArgs = templateEditArgs({ recipe, sceneFiles, music, voiceover, width, height, fps, duration: templateDuration(recipe), output: film });
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...editArgs]);
  return { film, work, sceneFiles };
}

/* ---------- frame analysis ---------- */

/* Grey frames at `sampleFps`, small. Returns [{t, frame}] (frame is a Buffer). */
async function greyFrames(file, sampleFps, w = 160, h = 90) {
  const frames = await sampleFrames(file, { width: w, height: h, fps: sampleFps });
  return frames.map((frame, i) => ({ t: i / sampleFps, frame, w, h }));
}
const meanOf = (frame) => { let s = 0; for (let i = 0; i < frame.length; i += 1) s += frame[i]; return s / frame.length; };
const meanDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; };
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 0; };
/* Colour frames at fixed times, small. Returns [{t, r, g, b}] means. */
async function colorSamples(file, times, w = 160, h = 90) {
  const out = [];
  for (const t of times) {
    const raw = await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=area,format=rgb24`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
      const chunks = [];
      child.stdout.on("data", (c) => chunks.push(c));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("color sample failed"))));
    });
    let r = 0, g = 0, b = 0;
    const n = raw.length / 3;
    for (let i = 0; i < raw.length; i += 3) { r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; }
    out.push({ t, r: r / n, g: g / n, b: b / n });
  }
  return out;
}
function bandMean(frames, y0, y1) {
  return frames.map(({ t, frame, w, h }) => {
    const top = Math.floor(h * y0), bottom = Math.floor(h * y1);
    let sum = 0, n = 0;
    for (let y = top; y < bottom; y += 1) for (let x = 0; x < w; x += 1) { sum += frame[y * w + x]; n += 1; }
    return { t, mean: sum / Math.max(1, n) };
  });
}
/* Bright-pixel fraction of a horizontal band (y0..y1 as fractions).
   White caption text on a dark background reads ~0.03-0.04 here (the
   text strokes) against a ~0.00 room baseline. */
function bandBright(frame, w, h, y0, y1) {
  const top = Math.floor(h * y0), bottom = Math.floor(h * y1);
  let bright = 0, n = 0;
  for (let y = top; y < bottom; y += 1) for (let x = 0; x < w; x += 1) { if (frame[y * w + x] > 200) bright += 1; n += 1; }
  return bright / Math.max(1, n);
}
/* One grey frame at time t (for targeted checks that cannot afford a
   full-frame sweep). */
async function greyFrameAt(file, t, w = 540, h = 960) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("grey frame failed"))));
  });
  return { t, frame: raw, w, h };
}
/* Laplacian variance restricted to a horizontal band (y0..y1 as
   fractions). Text is dense sharp edges, so a caption in the band reads
   4-20x the room-only baseline even on a bright white wall. */
function bandSharpness(frame, w, h, y0, y1) {
  const top = Math.max(1, Math.floor(h * y0)), bottom = Math.min(h - 1, Math.floor(h * y1));
  let sum = 0, sum2 = 0, n = 0;
  for (let y = top; y < bottom; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x;
    const v = 4 * frame[i] - frame[i - 1] - frame[i + 1] - frame[i - w] - frame[i + w];
    sum += v; sum2 += v * v; n += 1;
  }
  const mean = sum / Math.max(1, n);
  return sum2 / Math.max(1, n) - mean * mean;
}
/* Mean RGB in a horizontal band of one frame (for a grade measured where
   the subject is, not where the sky is). */
async function colorBand(file, t, y0, y1, w = 160, h = 90) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=area,format=rgb24`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("color band failed"))));
  });
  const top = Math.floor(h * y0), bottom = Math.floor(h * y1);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = top; y < bottom; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 3;
    r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; n += 1;
  }
  return { t, r: r / Math.max(1, n), g: g / Math.max(1, n), b: b / Math.max(1, n) };
}

/* A time when no caption is on screen anywhere in the film, for use as
   a clean baseline. A time counts only if it is >= 0.3s clear of every
   caption edge (so a fade is never sampled) and sits in a real content
   scene (>= 0.8s, not a white_flash, >= 0.3s after its start and >= 0.2s
   before its end, so a cut or flash is never sampled). Preferred forward
   from `after`, else backward from `before`. Captions that run
   back-to-back to a scene's end (house-calling's three captions cover
   0-5s with no gap) have no clean in-scene baseline at all, so the
   search must cross into a later scene — the old code just took
   end + 0.5s, which lands on the NEXT caption and reads as if the
   caption were absent. */
function captionFreeTime(recipe, after, before) {
  const caps = [];
  for (const s of recipe.scenes) for (const c of s.captions || []) {
    const e = c.fade_out_s ? c.fade_out_s[1] : c.end_s;
    caps.push([c.start_s, e]);
  }
  const free = (t) => caps.every(([a, b]) => t < a - 0.3 || t > b + 0.3);
  const sceneAt = (t) => recipe.scenes.find((s) => t >= s.start_s && t < s.start_s + s.duration_s);
  const usable = (t) => {
    const s = sceneAt(t);
    if (!s || s.type === "white_flash" || s.duration_s < 0.8) return false;
    return t - s.start_s >= 0.3 && s.start_s + s.duration_s - t >= 0.2;
  };
  const total = templateDuration(recipe);
  for (let t = after + 0.05; t < total; t += 0.05) if (free(t) && usable(t)) return t;
  for (let t = before - 0.05; t >= 0; t -= 0.05) if (free(t) && usable(t)) return t;
  return null;
}

/* ---------- the checks (spec §5a) ---------- */

const { film } = await renderOnce("run1");
const total = templateDuration(recipe);
const frames10 = await greyFrames(film, 10);
const frames30 = await greyFrames(film, 30);

// 1. Scene boundaries: a cut (or the flash) shows as a frame-difference spike.
//    The spike must be at the right time and clearly above the film's own
//    motion: 3x the median frame difference. Video inputs carry real
//    motion, so their median is high and a cut reads only ~3.5x it;
//    stills read 60x. A 3x bar with the right time is a cut in both.
{
  const diffs = [];
  for (let i = 1; i < frames10.length; i += 1) diffs.push({ t: frames10[i].t, d: meanDiff(frames10[i - 1].frame, frames10[i].frame) });
  const base = median(diffs.map((x) => x.d));
  const found = [];
  for (const scene of recipe.scenes.slice(1)) {
    const win = diffs.filter((x) => Math.abs(x.t - scene.start_s) <= 0.15);
    const peak = win.reduce((best, x) => (x.d > best.d ? x : best), { t: 0, d: 0 });
    found.push({ at: scene.start_s, detected: peak.t, spike: peak.d });
  }
  const ok = found.every((f) => Math.abs(f.detected - f.at) <= 0.15 && f.spike > Math.max(8, base * 3));
  check("1 scene boundaries", ok, found.map((f) => `${f.at}s→${f.detected.toFixed(2)}s (spike ${f.spike.toFixed(1)}, base ${base.toFixed(1)})`).join("; "));
}

// 2. Captions: on screen in the right window. Measured per caption as
//    the caption band's sharpness (Laplacian variance, y 0.30-0.55) and
//    bright-pixel fraction at the caption's midpoint versus the same band
//    at a caption-free time. Text is dense sharp edges, so the band reads
//    4-20x the room-only baseline even on a bright white wall, where a
//    brightness measure cannot see white text at all; on a dark
//    background the white strokes also lift the bright fraction from
//    ~0.00 to ~0.03. Either signal passing is enough. The baseline must
//    be genuinely caption-free (captionFreeTime): sampling end + 0.5s
//    lands on the next caption when captions run back-to-back. The exact
//    text is checked at the filter-graph level by the unit tests.
{
  const notes = [];
  let ok = true;
  for (const scene of recipe.scenes) for (const caption of scene.captions || []) {
    const end = caption.fade_out_s ? caption.fade_out_s[1] : caption.end_s;
    const mid = (caption.start_s + end) / 2;
    const afterT = captionFreeTime(recipe, end, caption.start_s) ?? Math.min(scene.start_s + scene.duration_s - 0.1, end + 0.5);
    const inFrame = await greyFrameAt(film, mid);
    const afterFrame = await greyFrameAt(film, afterT);
    const inSharp = bandSharpness(inFrame.frame, inFrame.w, inFrame.h, 0.30, 0.55);
    const afterSharp = bandSharpness(afterFrame.frame, afterFrame.w, afterFrame.h, 0.30, 0.55);
    const inBright = bandBright(inFrame.frame, inFrame.w, inFrame.h, 0.30, 0.55);
    const afterBright = bandBright(afterFrame.frame, afterFrame.w, afterFrame.h, 0.30, 0.55);
    // Ratio, or an absolute rise: a video input's own motion lifts the
    // room baseline (a gesturing person reads ~250), which compresses
    // the ratio even though the caption still adds ~150+ of edge
    // density. A missing caption adds ~0 (the same scene, 0.5s apart).
    // Brightness is the same shape for white text on a dark background.
    const sharpOk = inSharp > 2.5 * Math.max(afterSharp, 1) || (inSharp - afterSharp) > 80;
    const brightOk = inBright > 3 * Math.max(afterBright, 0.005) || (inBright - afterBright) > 0.02;
    const good = sharpOk || brightOk;
    if (!good) ok = false;
    notes.push(`"${caption.text}" ${caption.start_s}-${end}s: band sharpness ${inSharp.toFixed(1)} vs after ${afterSharp.toFixed(1)} (${(inSharp / Math.max(afterSharp, 0.01)).toFixed(1)}x, +${(inSharp - afterSharp).toFixed(1)}); bright ${inBright.toFixed(3)} vs after ${afterBright.toFixed(3)}`);
  }
  check("2 captions in window", ok, notes.join("; ") || "no captions in recipe");
}

// 3. Call banner: slides in, holds, slides out — read from the recipe's own
//    overlay windows. The banner is a dark card, so it is measured RELATIVE
//    to the same frame's lower band (top < bottom - 25): later scenes can be
//    darker than the first scene's base luma, which an absolute measure
//    cannot tell from a banner. Scoped to the banner scene's own window.
{
  const bannerScene = recipe.scenes.find((s) => s.overlay?.type === "call_banner");
  if (!bannerScene) { check("3 call banner", true, "no call banner in recipe — skipped"); }
  else {
    const overlay = bannerScene.overlay;
    const sceneEnd = bannerScene.start_s + bannerScene.duration_s;
    const top = bandMean(frames30, 0.03, 0.17);
    const bottom = bandMean(frames30, 0.75, 0.95);
    const inScene = top.map((b, i) => ({ t: b.t, dark: b.mean < bottom[i].mean - 25 })).filter((b) => b.t >= bannerScene.start_s && b.t <= sceneEnd);
    const absentBefore = !inScene.some((b) => b.t < overlay.slide_in_s[0] - 0.1 && b.dark);
    const firstDark = inScene.find((b) => b.dark);
    const lastDark = [...inScene].reverse().find((b) => b.dark);
    const held = inScene.filter((b) => b.t >= overlay.visible_s[0] && b.t <= overlay.visible_s[1] && b.dark).length;
    const holdTotal = inScene.filter((b) => b.t >= overlay.visible_s[0] && b.t <= overlay.visible_s[1]).length;
    const absentAfter = !inScene.some((b) => b.t > overlay.slide_out_s[1] + 0.2 && b.dark);
    const inOk = firstDark && firstDark.t >= overlay.slide_in_s[0] && firstDark.t <= overlay.slide_in_s[1] + 0.15;
    const outOk = lastDark && lastDark.t >= overlay.slide_out_s[0] + 0.2 && lastDark.t <= overlay.slide_out_s[1] + 0.15;
    const ok = absentBefore && inOk && held / Math.max(1, holdTotal) > 0.7 && outOk && absentAfter;
    check("3 call banner", ok, `absent before ${overlay.slide_in_s[0]}s: ${absentBefore}; first dark ${firstDark?.t.toFixed(2) ?? "?"}s (want ${overlay.slide_in_s[0]}-${overlay.slide_in_s[1] + 0.15}); held ${held}/${holdTotal} frames ${overlay.visible_s[0]}-${overlay.visible_s[1]}s; last dark ${lastDark?.t.toFixed(2) ?? "?"}s (want ${overlay.slide_out_s[0] + 0.2}-${overlay.slide_out_s[1] + 0.15}); absent after ${overlay.slide_out_s[1] + 0.2}s: ${absentAfter}`);
  }
}

// 4. White flash: blown out at the flash scene's peak. No flash scene,
//    no check.
{
  const flash = recipe.scenes.find((s) => s.type === "white_flash");
  if (!flash) { check("4 white flash", true, "no white_flash scene — skipped"); }
  else {
    const luma = frames30.map(({ t, frame }) => ({ t, m: meanOf(frame) }));
    const win = luma.filter((x) => x.t >= flash.start_s && x.t <= flash.start_s + flash.duration_s);
    const peak = win.reduce((best, x) => (x.m > best.m ? x : best), { t: 0, m: 0 });
    const ok = peak.m > 235 && peak.t >= flash.peak_s - 0.15 && peak.t <= flash.peak_s + 0.15;
    check("4 white flash", ok, `peak luma ${peak.m.toFixed(0)} at ${peak.t.toFixed(2)}s (want >235 at ${flash.peak_s}s)`);
  }
}

// 5. Transitions: hard cuts at the right times; the whip frame is blurred.
{
  const diffs = [];
  for (let i = 1; i < frames10.length; i += 1) diffs.push({ t: frames10[i].t, d: meanDiff(frames10[i - 1].frame, frames10[i].frame) });
  const base = median(diffs.map((x) => x.d));
  const cuts = recipe.scenes.filter((s) => s.transition_in === "hard_cut");
  const cutNotes = cuts.map((s) => {
    const peak = diffs.filter((x) => Math.abs(x.t - s.start_s) <= 0.15).reduce((best, x) => (x.d > best.d ? x : best), { t: 0, d: 0 });
    return `${s.start_s}s→${peak.t.toFixed(2)}s (${peak.d.toFixed(1)})`;
  });
  const cutsOk = cuts.every((s) => {
    const peak = diffs.filter((x) => Math.abs(x.t - s.start_s) <= 0.15).reduce((best, x) => (x.d > best.d ? x : best), { t: 0, d: 0 });
    return Math.abs(peak.t - s.start_s) <= 0.15 && peak.d > Math.max(8, base * 3);
  });
  // Every whip_blur boundary: the whip frame is blurred, its neighbours
  // are not. Before/after take the sharper of two samples, because a
  // ramped scene's fast exit (just before the cut) is blurred by the
  // ramp itself, not by the whip. The whip reduces sharpness to
  // 0.34-0.60x of the sharper neighbour at this sampling; a hard cut
  // would read ~1.0x, so 0.65x (a >=35% drop) is the bar.
  const whips = recipe.scenes.filter((s) => s.transition_in === "whip_blur");
  let whipNote = "no whip_blur in recipe";
  let whipOk = true;
  if (whips.length) {
    const at = (t) => { const f = frames30.find((x) => Math.abs(x.t - t) < 0.04); return f ? sharpness(f.frame, f.w, f.h) : 0; };
    const notes = [];
    for (const whip of whips) {
      const before = Math.max(at(whip.start_s - 1.0), at(whip.start_s - 0.5));
      const during = at(whip.start_s + 0.07);
      const after = Math.max(at(whip.start_s + 0.6), at(whip.start_s + 1.0));
      if (!(during < 0.65 * Math.max(before, after, 1))) whipOk = false;
      notes.push(`${whip.start_s}s: ${before.toFixed(1)} → ${during.toFixed(1)} → ${after.toFixed(1)}`);
    }
    whipNote = `whips: ${notes.join("; ")}`;
  }
  check("5 transitions", cutsOk && whipOk, `hard cuts: ${cutNotes.join("; ")}; ${whipNote}`);
}

// 6. No caption after the last caption ends. Measured as the caption
//    band's sharpness after the last caption ends versus during it: if
//    the text were stuck on, the after frames would carry the same
//    sharp text edges. A bright room's own pixels cannot trip this —
//    only text edges raise the band sharpness. Flash and whip windows
//    are excluded (a white flash and a smeared whip are not captions).
{
  const allCaptions = recipe.scenes.flatMap((s) => (s.captions || []).map((c) => ({ ...c, scene: s })));
  if (!allCaptions.length) { check("6 no caption after last ends", true, "no captions in recipe — skipped"); }
  else {
    const last = allCaptions.reduce((best, c) => {
      const end = c.fade_out_s ? c.fade_out_s[1] : c.end_s;
      return end > best.end ? { ...c, end } : best;
    }, { end: -1 });
    const lastEnd = last.end;
    const lastStart = last.start_s;
    const duringFrame = await greyFrameAt(film, (lastStart + lastEnd) / 2);
    const duringSharp = bandSharpness(duringFrame.frame, duringFrame.w, duringFrame.h, 0.30, 0.55);
    const flashWindows = recipe.scenes.filter((s) => s.type === "white_flash").map((s) => [s.start_s, s.start_s + s.duration_s]);
    const inFlash = (t) => flashWindows.some(([a, b]) => t >= a && t <= b);
    const whipWindows = recipe.scenes.filter((s) => s.transition_in === "whip_blur").map((s) => [s.start_s - 0.15, s.start_s + 0.15]);
    const inWhip = (t) => whipWindows.some(([a, b]) => t >= a && t <= b);
    const probeTimes = [];
    for (let t = lastEnd + 0.3; t <= total - 0.2; t += 0.5) if (!inFlash(t) && !inWhip(t)) probeTimes.push(t);
    let maxAfter = 0, maxAt = 0;
    for (const t of probeTimes) {
      const f = await greyFrameAt(film, t);
      const s = bandSharpness(f.frame, f.w, f.h, 0.30, 0.55);
      if (s > maxAfter) { maxAfter = s; maxAt = t; }
    }
    const ok = maxAfter < 0.5 * duringSharp;
    check("6 no caption after last ends", ok, `band sharpness during last caption ${duringSharp.toFixed(1)} vs max after ${lastEnd}s: ${maxAfter.toFixed(1)} at ${maxAt.toFixed(2)}s (${(maxAfter / Math.max(duringSharp, 0.01)).toFixed(2)}x, want < 0.5x)`);
  }
}

// 7. Output: duration, size, fps, audio, no black frames at the ends.
{
  const qc = await templateQualityCheck(film, { recipe, width, height, fps });
  const audioExpected = Boolean(args.music || args.voiceover);
  const relevant = qc.checks.filter((c) => c.id !== "audio" || audioExpected);
  const ok = relevant.every((c) => c.pass);
  check("7 output", ok, qc.checks.map((c) => `${c.id}: ${c.pass ? "ok" : "FAIL"} (${c.detail})`).join("; "));
}

// 8. Speed ramps: the curve is real, not a note. Three parts.
//   (a) Calibration speed: each ramped scene rendered alone from a bar
//       clip (a solid grey frame whose brightness rises linearly with
//       source time, geq) with a static move and no grade or captions,
//       so the output brightness slope IS the playback speed. The
//       measured speed at five points must match the recipe curve
//       within 35%. The bar's slope is measured by least-squares
//       regression over t=1..7s, and the calibration is rejected if the
//       bar is not linear (a swept gradient saturates, which silently
//       halved every measured speed).
//   (b) Calibration blur: the same scene rendered from a detailed
//       still (testsrc2 frame) with the scene's move and no captions or
//       grade. The fast points must be measurably blurred and the slow
//       points sharp. The film itself cannot be used for this: a caption
//       drawn after the ramp inflates whole-frame sharpness whenever it
//       is on screen, which masks the blur entirely.
//   (c) The film itself: where the move is a glide, the fast points
//       must move faster (frame-difference energy). A push-in's motion
//       is too small to measure by energy, so its blur carries it.
{
  const ramps = (recipe.speed_ramps || []).filter((r) => Array.isArray(r.points));
  if (!ramps.length) { check("8 speed ramp", true, "no ramp points in recipe — skipped"); }
  else {
    const pts = [0.05, 0.25, 0.5, 0.75, 0.95];
    const curveAt = (sampled, u) => {
      if (u <= sampled[0][0]) return sampled[0][1];
      for (let k = 1; k < sampled.length; k += 1) {
        if (u <= sampled[k][0]) {
          const [u0, s0] = sampled[k - 1], [u1, s1] = sampled[k];
          return s0 + (s1 - s0) * ((u - u0) / Math.max(1e-6, u1 - u0));
        }
      }
      return sampled[sampled.length - 1][1];
    };
    // (a) the bar: a solid grey frame brightening linearly with source
    // time. The exact slope does not matter — it is measured. The base
    // is 48 (not near-black): a bar starting at luma 0 clips to black
    // for its first half-second, which corrupts the speed measured at
    // the scene's start.
    const bar = path.join(dir, "ramp-bar.mp4");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `nullsrc=s=${width}x${height}:r=${fps}:d=8,geq=lum='48+24*T':cb=128:cr=128`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", bar]);
    const barFrames = await greyFrames(bar, 10);
    const barLuma = (t) => { const f = barFrames.find((x) => Math.abs(x.t - t) < 0.06); return f ? meanOf(f.frame) : 0; };
    // Least-squares slope over t=1..7s (the linear region; the bar
    // clips near white past ~7.5s).
    const regPts = [1, 2, 3, 4, 5, 6, 7].map((t) => [t, barLuma(t)]);
    const nReg = regPts.length;
    const mt = regPts.reduce((s, [t]) => s + t, 0) / nReg;
    const mv = regPts.reduce((s, [, v]) => s + v, 0) / nReg;
    const slopeSrc = regPts.reduce((s, [t, v]) => s + (t - mt) * (v - mv), 0) / regPts.reduce((s, [t]) => s + (t - mt) * (t - mt), 0);
    const maxRes = Math.max(...regPts.map(([t, v]) => Math.abs(v - (mv + slopeSrc * (t - mt)))));
    const notes = [];
    let ok = slopeSrc > 10 && maxRes < 5;
    if (!ok) notes.push(`bar clip not usable: slope ${slopeSrc.toFixed(1)} luma/s, max regression residual ${maxRes.toFixed(1)} (want slope > 10, residual < 5)`);
    else notes.push(`bar slope ${slopeSrc.toFixed(1)} luma/s (residual ${maxRes.toFixed(1)})`);
    // (b) the detailed still for the blur calibration: a testsrc2 frame,
    // uniform fine detail, no caption, no grade.
    const detailStill = path.join(dir, "ramp-detail.jpg");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=${width}x${height}:r=${fps}:d=1`, "-frames:v", "1", detailStill]);
    for (const ramp of ramps) {
      const scene = recipe.scenes.find((s) => s.id === ramp.scene);
      const sampled = sampleRampCurve(ramp.points);
      // (a) calibration render: static move, no grade, no captions.
      const calScene = { id: scene.id, duration_s: scene.duration_s, camera: { move: "static", speed: "constant" }, transition_in: "open" };
      const calOut = path.join(dir, `ramp-cal-${scene.id}.mp4`);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe, scene: calScene, input: bar, output: calOut, width, height, fps, start: 0, available: 8 })]);
      const calFrames = await greyFrames(calOut, 30);
      // Least-squares slope of luma vs time over the frames in a
      // window around the point. Two endpoints are not enough: a
      // slow speed moves the brightness only a few levels over the
      // window, so one level of luma quantization at either end is a
      // 30-40% error in the speed. Regression over ~15 frames cuts
      // that to ~5%.
      const slopeOver = (t1, t2) => {
        const pts = calFrames.filter((f) => f.t >= t1 && f.t <= t2).map((f) => [f.t, meanOf(f.frame)]);
        if (pts.length < 3) return 0;
        const n = pts.length;
        const mt = pts.reduce((s, [t]) => s + t, 0) / n;
        const mv = pts.reduce((s, [, v]) => s + v, 0) / n;
        return pts.reduce((s, [t, v]) => s + (t - mt) * (v - mv), 0) / Math.max(1e-9, pts.reduce((s, [t]) => s + (t - mt) * (t - mt), 0));
      };
      const measured = pts.map((u) => {
        const t = u * scene.duration_s;
        // A ±0.25s window: slow speeds move the brightness only a few
        // levels over a short window, so a narrow window is noise.
        const t1 = Math.max(0.02, t - 0.25), t2 = Math.min(scene.duration_s - 0.02, t + 0.25);
        return slopeOver(t1, t2) / slopeSrc;
      });
      const expected = pts.map((u) => curveAt(sampled, u));
      const calOk = measured.every((m, k) => Math.abs(m - expected[k]) <= 0.35 * expected[k]);
      if (!calOk) ok = false;
      // (b) blur calibration: the scene's own move, no grade/captions,
      // from the detailed still. Fast = the most-blurred frame across
      // the fast entry and exit (tmix needs a few frames to build up,
      // so the very first fast frame is sharp); slow = the sharpest
      // frame across the slow middle.
      const need = rampSourceSeconds(ramp.points, scene.duration_s) + 0.3;
      const detailClip = await stillToClip({ input: detailStill, output: path.join(dir, `ramp-blur-detail-${scene.id}.mp4`), width, height, fps, seconds: need });
      const blurScene = { id: scene.id, duration_s: scene.duration_s, camera: scene.camera, transition_in: "open" };
      const blurOut = path.join(dir, `ramp-blur-${scene.id}.mp4`);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe, scene: blurScene, input: detailClip, output: blurOut, width, height, fps, start: 0, available: need })]);
      const blurFrames = await greyFrames(blurOut, 30, 540, 960);
      const blurSharp = (u) => { const f = blurFrames.find((x) => Math.abs(x.t - u * scene.duration_s) < 0.04); return f ? sharpness(f.frame, f.w, f.h) : 0; };
      const fastUs = [0.05, 0.10, 0.15, 0.85, 0.90, 0.95];
      const slowUs = [0.4, 0.5, 0.6];
      const fastSharp = Math.min(...fastUs.map(blurSharp));
      const slowSharp = Math.max(...slowUs.map(blurSharp));
      // >=20% drop is the bar: a push-in's blur is inherently weaker
      // than a glide's (a 6% zoom smears ~2px where a glide smears
      // ~25px), but it is real and visible; a constant-speed scene
      // with no blur reads ~1.0x.
      const blurOk = slowSharp > 5 && fastSharp < 0.80 * slowSharp;
      if (!blurOk) ok = false;
      // (c) the film: motion energy at the same points (glides only).
      // Only when the scene's input is a still photo: the recipe's move
      // is then the only motion, so the energy isolates the ramp. A
      // video clip's own motion (a gesturing person, a panning camera)
      // dominates the frame difference and swamps the ramp entirely —
      // on clips the slow points can read faster than the fast ones.
      const inputIsStill = (slot) => ["jpg", "jpeg", "png", "webp"].some((ext) => fs.existsSync(path.join(String(args.inputs), `${slot}.${ext}`)));
      const at = (t) => frames30.find((x) => Math.abs(x.t - t) < 0.04);
      const energies = pts.map((u) => {
        const a = at(scene.start_s + u * scene.duration_s), b = at(scene.start_s + u * scene.duration_s + 1 / fps);
        return a && b ? meanDiff(a.frame, b.frame) : 0;
      });
      const fastIdx = pts.map((u, k) => ({ u, k, s: expected[k] })).filter((x) => x.s >= 1.8).map((x) => x.k);
      const slowIdx = pts.map((u, k) => ({ u, k, s: expected[k] })).filter((x) => x.s <= 0.7).map((x) => x.k);
      let filmNote = "";
      if (fastIdx.length && slowIdx.length && ["glide", "glide_lateral", "tilt_down_glide"].includes(scene.camera.move) && inputIsStill(scene.input)) {
        const fastE = Math.min(...fastIdx.map((k) => energies[k]));
        const slowE = Math.max(...slowIdx.map((k) => energies[k]));
        const energyOk = fastE >= 1.5 * Math.max(slowE, 0.5);
        if (!energyOk) ok = false;
        filmNote = `; film energy fast ${fastE.toFixed(2)} vs slow ${slowE.toFixed(2)} (${energyOk ? "ok" : "FAIL"})`;
      } else if (["glide", "glide_lateral", "tilt_down_glide"].includes(scene.camera.move)) {
        filmNote = `; film energy ${energies.map((e) => e.toFixed(2)).join("/")} (video input — source motion swamps the ramp, not required)`;
      } else {
        filmNote = `; film energy ${energies.map((e) => e.toFixed(2)).join("/")} (push-in — reported, not required)`;
      }
      notes.push(`${ramp.scene}: speeds ${measured.map((m) => m.toFixed(2)).join("/")} vs curve ${expected.map((e) => e.toFixed(2)).join("/")} (${calOk ? "cal ok" : "CAL FAIL"}); blur fast ${fastSharp.toFixed(1)} vs slow ${slowSharp.toFixed(1)} (${blurOk ? "ok" : "FAIL"})${filmNote}`);
    }
    check("8 speed ramp", ok, notes.join("; "));
  }
}

// 9. Grade: day scenes bright/warm, night scenes dark/blue, interiors warm.
//    A bright day exterior is measured where the house and land are (the
//    bottom half), not the whole frame — a blue sky is blue by nature and
//    would fail a whole-frame R>=B even on a correctly warmed grade.
{
  const scenes = recipe.scenes.filter((s) => s.type !== "white_flash");
  const samples = await colorSamples(film, scenes.map((s) => s.start_s + s.duration_s / 2));
  const notes = [];
  let ok = true;
  for (let i = 0; i < samples.length; i += 1) {
    const scene = scenes[i];
    const { r, g, b } = samples[i];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let good = true, want = "";
    // The effective grade: a night slot renders with the night grade
    // instead of the scene's own grade (see templateShotArgs).
    const night = (recipe.night_slots || []).includes(scene.id) || (recipe.night_slots || []).includes(scene.input);
    const grade = night ? "night_warm_windows" : scene.grade;
    if (grade === "bright_warm_day") {
      const bottom = await colorBand(film, scene.start_s + scene.duration_s / 2, 0.5, 0.95);
      good = luma > 100 && bottom.r > bottom.b;
      want = `bright (luma ${luma.toFixed(0)} > 100), warm land R>B in bottom half (${bottom.r.toFixed(0)} > ${bottom.b.toFixed(0)})`;
    }
    if (grade === "night_warm_windows") { good = luma < 110 && b > r; want = "dark, B>R"; }
    if (grade === "warm_evening_interior") { good = r > b; want = "R>B"; }
    if (!good) ok = false;
    notes.push(`${scene.id} (${grade}${night ? ", night slot" : ""}): RGB ${r.toFixed(0)}/${g.toFixed(0)}/${b.toFixed(0)} luma ${luma.toFixed(0)} — want ${want}`);
  }
  check("9 grade", ok, notes.join("; "));
}

// 5b.1 Determinism: same recipe + same inputs, rendered 3x, must be frame-identical.
if (args.determinism) {
  const hashFrames = async (file) => {
    const frames = await sampleFrames(file, { width: 160, height: 90, fps: 2 });
    return frames.map((f) => createHash("sha256").update(f).digest("hex").slice(0, 12)).join(",");
  };
  const a = await hashFrames(film);
  const second = await renderOnce("run2");
  const b = await hashFrames(second.film);
  const third = await renderOnce("run3");
  const c = await hashFrames(third.film);
  check("5b.1 determinism", a === b && b === c, `3 renders, ${a.split(",").length} sampled frames each — ${a === b && b === c ? "identical" : "DIFFER"}`);
}

// Ducking: the music must drop under a voiceover (measured on the exact chain).
if (args.voiceover && args.music) {
  const duckOut = path.join(dir, "ducked.wav");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", String(args.music), "-i", String(args.voiceover),
    "-filter_complex",
    `[0:a]aresample=48000,apad,atrim=duration=16,asetpts=PTS-STARTPTS[mus];[1:a]aresample=48000,apad,atrim=duration=16,asetpts=PTS-STARTPTS[vo];[mus][vo]${DUCK_FILTER}[ducked]`,
    "-map", "[ducked]", "-t", "16", duckOut]);
  // RMS level of a file in a 1s window, from astats on stderr.
  const rmsIn = (file, from) => new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-i", file, "-ss", String(from), "-t", "1", "-af", "astats=metadata=1:reset=0", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", () => { const m = /RMS level dB:\s*(-?[\d.]+)/.exec(err); resolve(m ? Number(m[1]) : null); });
  });
  // Where the voiceover itself is loud vs quiet, measured on the voiceover file.
  const windows = [];
  for (let t = 0; t < 15; t += 1) windows.push({ t, rms: await rmsIn(String(args.voiceover), t) });
  const loud = windows.filter((w) => w.rms !== null).sort((a, b) => b.rms - a.rms)[0];
  const quiet = windows.filter((w) => w.rms !== null).sort((a, b) => a.rms - b.rms)[0];
  const duckedLoud = loud ? await rmsIn(duckOut, loud.t) : null;
  const duckedQuiet = quiet ? await rmsIn(duckOut, quiet.t) : null;
  const drop = duckedLoud !== null && duckedQuiet !== null ? duckedQuiet - duckedLoud : null;
  check("ducking", drop !== null && drop >= 6, `voiceover loud at ${loud?.t ?? "?"}s (${loud?.rms?.toFixed(1) ?? "?"} dB), quiet at ${quiet?.t ?? "?"}s (${quiet?.rms?.toFixed(1) ?? "?"} dB); ducked music ${duckedQuiet?.toFixed(1) ?? "?"} dB vs ${duckedLoud?.toFixed(1) ?? "?"} dB under voice (drop ${drop?.toFixed(1) ?? "?"} dB, want >= 6 dB)`);
}

const report = { template: recipe.template_id, recipe_version: recipe.recipe_version, duration_s: total, size: `${width}x${height}`, fps, checks: results, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, film };
fs.writeFileSync(path.join(outDir, "verification-report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${report.failed} failed — report: ${path.join(outDir, "verification-report.json")}`);
console.log(`film: ${film} (work dir ${dir} — kept for inspection)`);
process.exit(report.failed ? 1 : 0);
