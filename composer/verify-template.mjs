/* Verify a template recipe against its render (spec §5a), plus the
   determinism half of §5b.1.

   Usage:
     node composer/verify-template.mjs --recipe composer/templates/house-calling-v1.json \
       --inputs <dir of clips, one per input slot, named <slot>.mp4> \
       --music <file.mp3> [--voiceover <file.mp3>] \
       --out <dir> [--size 1080x1920] [--fps 30] [--determinism]

   It renders the template with FIXED test inputs, then checks each §5a
   item pass/fail from the frames themselves — no eyeballing, no OCR
   (the container ships tesseract, but this box may not; caption text
   exactness is checked at the filter-graph level by the unit tests, and
   the frames here are checked for the caption being on screen in the
   right window). Prints one PASS/FAIL line per check plus a JSON
   report, and exits 1 when any check fails.

   What it cannot check: that a caption's letters are exactly right
   (needs OCR — see above), and that a grade "feels" right on real
   footage (it checks channel balance and brightness only, per scene). */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTemplateRecipe, planTemplateScenes, templateDuration, templateShotArgs, templateEditArgs, templateQualityCheck, makeCallBanner, DUCK_FILTER } from "./template-recipe.mjs";
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
  const clipFiles = recipe.inputs.map((input) => path.join(String(args.inputs), `${input.slot}.mp4`));
  for (const [i, file] of clipFiles.entries()) if (!fs.existsSync(file)) fail(`missing input clip for slot "${recipe.inputs[i].slot}": ${file}`);
  const durations = clipFiles.map(durOf);
  const picks = planTemplateScenes(recipe, durations);
  let bannerFile = null;
  const bannerScene = recipe.scenes.find((s) => s.overlay?.type === "call_banner");
  if (bannerScene) bannerFile = await makeCallBanner({ title: bannerScene.overlay.title, subtitle: bannerScene.overlay.subtitle, width, height, dir: work });
  const sceneFiles = [];
  for (let i = 0; i < picks.length; i += 1) {
    const pick = picks[i];
    const out = path.join(work, `scene-${String(i + 1).padStart(2, "0")}.mp4`);
    const input = clipFiles[pick.clip];
    const shotArgs = templateShotArgs({ recipe, scene: pick.scene, input, output: out, width, height, fps, start: pick.start, bannerFile: pick.scene.overlay ? bannerFile : null, available: durations[pick.clip] - pick.start });
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
/* Bright-pixel fraction of a horizontal band (y0..y1 as fractions). */
function bandBright(frames, y0, y1) {
  return frames.map(({ t, frame, w, h }) => {
    const top = Math.floor(h * y0), bottom = Math.floor(h * y1);
    let bright = 0, n = 0;
    for (let y = top; y < bottom; y += 1) for (let x = 0; x < w; x += 1) { if (frame[y * w + x] > 200) bright += 1; n += 1; }
    return { t, frac: bright / Math.max(1, n) };
  });
}
function bandMean(frames, y0, y1) {
  return frames.map(({ t, frame, w, h }) => {
    const top = Math.floor(h * y0), bottom = Math.floor(h * y1);
    let sum = 0, n = 0;
    for (let y = top; y < bottom; y += 1) for (let x = 0; x < w; x += 1) { sum += frame[y * w + x]; n += 1; }
    return { t, mean: sum / Math.max(1, n) };
  });
}

/* ---------- the checks (spec §5a) ---------- */

const { film } = await renderOnce("run1");
const total = templateDuration(recipe);
const frames10 = await greyFrames(film, 10);
const frames30 = await greyFrames(film, 30);

// 1. Scene boundaries: a cut (or the flash) shows as a frame-difference spike.
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
  const ok = found.every((f) => Math.abs(f.detected - f.at) <= 0.15 && f.spike > Math.max(8, base * 4));
  check("1 scene boundaries", ok, found.map((f) => `${f.at}s→${f.detected.toFixed(2)}s (spike ${f.spike.toFixed(1)}, base ${base.toFixed(1)})`).join("; "));
}

// 2. Captions: on screen in the right window (band brightness proxy;
//    the exact text is checked at the filter-graph level by the unit tests).
{
  const band = bandBright(frames30, 0.30, 0.55);
  const outside = band.filter((b) => !recipe.scenes.flatMap((s) => s.captions || []).some((c) => b.t >= c.start_s - 0.1 && b.t <= (c.fade_out_s ? c.fade_out_s[1] : c.end_s) + 0.1));
  const baseline = median(outside.map((b) => b.frac));
  const threshold = Math.max(0.02, baseline * 3 + 0.01);
  const notes = [];
  let ok = true;
  for (const scene of recipe.scenes) for (const caption of scene.captions || []) {
    const end = caption.fade_out_s ? caption.fade_out_s[1] : caption.end_s;
    const inside = band.filter((b) => b.t >= caption.start_s && b.t <= end);
    const on = inside.filter((b) => b.frac > threshold).length;
    const onFrac = inside.length ? on / inside.length : 0;
    const good = onFrac > 0.6;
    if (!good) ok = false;
    notes.push(`"${caption.text}" ${caption.start_s}-${end}s: bright in ${Math.round(onFrac * 100)}% of window (threshold ${threshold.toFixed(3)}, base ${baseline.toFixed(3)})`);
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

// 4. White flash at 5.0-5.4, blown out at ~5.2.
{
  const luma = frames30.map(({ t, frame }) => ({ t, m: meanOf(frame) }));
  const win = luma.filter((x) => x.t >= 5.0 && x.t <= 5.4);
  const peak = win.reduce((best, x) => (x.m > best.m ? x : best), { t: 0, m: 0 });
  const ok = peak.m > 235 && peak.t >= 5.05 && peak.t <= 5.35;
  check("4 white flash", ok, `peak luma ${peak.m.toFixed(0)} at ${peak.t.toFixed(2)}s (window 5.0-5.4s)`);
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
    return Math.abs(peak.t - s.start_s) <= 0.15 && peak.d > Math.max(8, base * 4);
  });
  const whip = recipe.scenes.find((s) => s.transition_in === "whip_blur");
  let whipNote = "no whip_blur in recipe";
  let whipOk = true;
  if (whip) {
    // Sharpness (Laplacian variance) at the whip vs just before/after.
    const at = (t) => { const f = frames30.find((x) => Math.abs(x.t - t) < 0.04); return f ? sharpness(f.frame, f.w, f.h) : 0; };
    const before = at(whip.start_s - 0.5), during = at(whip.start_s + 0.07), after = at(whip.start_s + 0.6);
    whipOk = during < 0.5 * Math.max(before, after, 1);
    whipNote = `whip at ${whip.start_s}s: sharpness ${before.toFixed(1)} → ${during.toFixed(1)} → ${after.toFixed(1)}${Math.max(before, after) < 5 ? " (low-detail input — this check is weak)" : ""}`;
  }
  check("5 transitions", cutsOk && whipOk, `hard cuts: ${cutNotes.join("; ")}; ${whipNote}`);
}

// 6. No caption after 5.0s. (A white_flash scene is white by design — its
//    frames are excluded, or the flash itself would trip this check. A
//    whip_blur boundary is blurred by design — its ±0.15s window is
//    excluded too, or the smeared caption pixels would trip it.)
{
  const band = bandBright(frames30, 0.30, 0.55);
  const flashWindows = recipe.scenes.filter((s) => s.type === "white_flash").map((s) => [s.start_s, s.start_s + s.duration_s]);
  const inFlash = (t) => flashWindows.some(([a, b]) => t >= a && t <= b);
  const whipWindows = recipe.scenes.filter((s) => s.transition_in === "whip_blur").map((s) => [s.start_s - 0.15, s.start_s + 0.15]);
  const inWhip = (t) => whipWindows.some(([a, b]) => t >= a && t <= b);
  const after = band.filter((b) => b.t > 5.0 && !inFlash(b.t) && !inWhip(b.t));
  const maxFrac = Math.max(...after.map((b) => b.frac));
  check("6 no caption after 5.0s", maxFrac < 0.02, `brightest caption-band frame after 5.0s (flash and whip windows excluded): ${(maxFrac * 100).toFixed(1)}% bright pixels`);
}

// 7. Output: duration, size, fps, audio, no black frames at the ends.
{
  const qc = await templateQualityCheck(film, { recipe, width, height, fps });
  const audioExpected = Boolean(args.music || args.voiceover);
  const relevant = qc.checks.filter((c) => c.id !== "audio" || audioExpected);
  const ok = relevant.every((c) => c.pass);
  check("7 output", ok, qc.checks.map((c) => `${c.id}: ${c.pass ? "ok" : "FAIL"} (${c.detail})`).join("; "));
}

// 8. Speed ramp curve (only when the recipe has one).
{
  const ramps = (recipe.speed_ramps || []).filter((r) => Array.isArray(r.points));
  if (!ramps.length) { check("8 speed ramp", true, "no ramp points in recipe — skipped"); }
  else {
    // Motion energy per slice of the ramped scene should follow the curve.
    const notes = [];
    let ok = true;
    for (const ramp of ramps) {
      const scene = recipe.scenes.find((s) => s.id === ramp.scene);
      const sliceFrames = await greyFrames(film, 10);
      const seg = sliceFrames.filter((f) => f.t >= scene.start_s && f.t < scene.start_s + scene.duration_s);
      const energies = [];
      for (let i = 1; i < seg.length; i += 1) energies.push(meanDiff(seg[i - 1].frame, seg[i].frame));
      const first = energies.slice(0, Math.max(1, Math.floor(energies.length / 3)));
      const last = energies.slice(-Math.max(1, Math.floor(energies.length / 3)));
      const firstMean = first.reduce((a, b) => a + b, 0) / first.length;
      const lastMean = last.reduce((a, b) => a + b, 0) / last.length;
      const rising = ramp.points[ramp.points.length - 1][1] > ramp.points[0][1];
      const follows = rising ? lastMean > firstMean : firstMean > lastMean;
      if (!follows) ok = false;
      notes.push(`${ramp.scene}: motion ${firstMean.toFixed(2)} → ${lastMean.toFixed(2)} (curve ${rising ? "rising" : "falling"})`);
    }
    check("8 speed ramp", ok, notes.join("; "));
  }
}

// 9. Grade: day scenes bright/warm, night scenes dark/blue, interiors warm.
{
  const samples = await colorSamples(film, recipe.scenes.filter((s) => s.type !== "white_flash").map((s) => s.start_s + s.duration_s / 2));
  const notes = [];
  let ok = true;
  for (let i = 0; i < samples.length; i += 1) {
    const scene = recipe.scenes.filter((s) => s.type !== "white_flash")[i];
    const { r, g, b } = samples[i];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let good = true, want = "";
    if (scene.grade === "bright_warm_day") { good = luma > 100 && r >= b; want = "bright, R>=B"; }
    if (scene.grade === "night_warm_windows") { good = luma < 110 && b > r; want = "dark, B>R"; }
    if (scene.grade === "warm_evening_interior") { good = r > b; want = "R>B"; }
    if (!good) ok = false;
    notes.push(`${scene.id} (${scene.grade}): RGB ${r.toFixed(0)}/${g.toFixed(0)}/${b.toFixed(0)} luma ${luma.toFixed(0)} — want ${want}`);
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
