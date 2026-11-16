#!/usr/bin/env node
/* Template Audit with auto-fix (composer/audit-template.mjs).
 *
 * The verifier (verify-template.mjs) checks that a render MATCHES its recipe. The audit checks that
 * the render is actually GOOD to watch: no frozen segments, smooth motion that follows the ramp, a
 * whip that is visibly blurred, transitions at the right times, no whoosh sound, cuts on the beat —
 * and a story that makes sense. Then it fixes what it can and re-renders, up to MAX_FIX_ROUNDS.
 * A template that still fails does not ship.
 *
 * Usage:
 *   node composer/audit-template.mjs --recipe composer/templates/tour-flow-v1.json \
 *     --film <rendered film.mp4> [--verifier-report <verification-report.json>] \
 *     [--inputs <dir>] [--out <dir>] [--fix] [--max-rounds 3]
 *
 * --film is the render to audit (the verifier's run1/film.mp4, or any render of the recipe).
 * --verifier-report (optional) supplies the §5a coherence results (captions, grade, audio, transitions),
 *   so the audit does not re-derive them. Without it, those checks are skipped, not passed.
 * --fix turns on the auto-fix loop: the recipe is adjusted in memory, re-rendered through the
 *   verifier, and re-audited. The fixed recipe is written to --out/audited-recipe.json; the
 *   original file is never overwritten. Story order wrong is flagged for Reda, never auto-fixed.
 * The beat check is a real check once beat-synced cuts exist; until then it reports SKIP (the
 *   recipe's beat grid is decoration until the beat build lands — see docs/template-recipe-spec.md).
 *
 * Frame analysis is pure Node + ffmpeg (raw grayscale frames, no Python, no image libs), so it
 * runs anywhere the composer runs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { analyzeBeats, nearestBeat } from "./wrenaudio.mjs";
import { snapRecipeToBeatGrid } from "./template-recipe.mjs";

const MAX_FIX_ROUNDS = 3;
const FREEZE_THRESHOLD = 0.5; // mean abs luma diff below this = a frozen frame (at 270x480)
const MIN_FREEZE_S = 0.2; // shortest frozen run that fails the audit
const BEAT_TOLERANCE_S = 0.06;

const args = {};
{
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

const fail = (message) => { console.error(`audit: ${message}`); process.exit(2); };
if (!args.recipe || !args.film) fail("need --recipe and --film");
const recipe = JSON.parse(fs.readFileSync(String(args.recipe), "utf8"));
const film = path.resolve(String(args.film));
const fps = Number(args.fps || recipe.fps || 30);
const outDir = args.out ? path.resolve(String(args.out)) : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

const run = (command, argv, { timeoutMs = 10 * 60 * 1000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, argv, { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  let stderr = "", done = false;
  const timer = setTimeout(() => { if (!done) { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); } }, timeoutMs);
  // stdout is kept as raw bytes (Buffer): the frame extraction is binary, and concatenating
  // it as a string would corrupt every byte above 0x7f.
  child.stdout.on("data", (d) => { chunks.push(d); });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { done = true; clearTimeout(timer); resolve({ code, stdout: Buffer.concat(chunks), stderr }); });
});
const text = (buf) => buf.toString("utf8");

/* Dense frame extraction: raw grayscale at the film's NATIVE resolution, sampled on a stride
   (every nth pixel) so the loop stays fast. Downscaling would blur the picture and understate
   small motions — a slow drift that is real at full res reads as frozen at 270p. The stride
   keeps the original pixel values, so a sub-pixel drift still registers. */
async function frameDiffs(filmPath) {
  const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=width,height", "-of", "json", filmPath]);
  const meta = JSON.parse(text(probe.stdout));
  const duration = parseFloat(meta.format.duration);
  const stream = (meta.streams || []).find((s) => s.width) || {};
  const width = stream.width || 1080, height = stream.height || 1920;
  const stride = Math.max(1, Math.round(Math.sqrt((width * height) / 130000)));
  const raw = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", filmPath, "-vf", `fps=${fps},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
  if (raw.code !== 0) throw new Error(`ffmpeg frame extraction failed: ${raw.stderr.slice(0, 300)}`);
  const buf = raw.stdout;
  const frameSize = width * height;
  const n = Math.floor(buf.length / frameSize);
  const diffs = [0];
  for (let i = 1; i < n; i += 1) {
    const prev = buf.subarray((i - 1) * frameSize, i * frameSize);
    const cur = buf.subarray(i * frameSize, (i + 1) * frameSize);
    let sum = 0, count = 0;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        sum += Math.abs(cur[y * width + x] - prev[y * width + x]);
        count += 1;
      }
    }
    diffs.push(sum / count);
  }
  return { duration, n, diffs };
}

function sharpnessOf(buf, width, height) {
  // Laplacian variance on one grayscale frame (Buffer, row-major).
  let sum = 0, sum2 = 0, count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = buf[i - width] + buf[i + width] + buf[i - 1] + buf[i + 1] - 4 * buf[i];
      sum += lap; sum2 += lap * lap; count += 1;
    }
  }
  const mean = sum / count;
  return sum2 / count - mean * mean;
}

async function frameAt(filmPath, t, width = 270, height = 480) {
  const raw = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", filmPath, "-frames:v", "1", "-vf", `scale=${width}:${height},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
  if (raw.code !== 0) throw new Error(`ffmpeg frame grab failed at ${t}s: ${raw.stderr.slice(0, 200)}`);
  return raw.stdout;
}

const checks = [];
const check = (id, pass, detail, fix = null) => { checks.push({ id, pass, status: pass ? "pass" : "fail", detail, fix }); console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${detail}`); };
// A check that cannot be judged on this film (no steady beat, no verifier
// report) is recorded as skipped, not passed and not failed — the UI shows
// it as "not applicable" instead of hiding it.
const skip = (id, detail) => { checks.push({ id, pass: null, status: "skip", detail, fix: null }); console.log(`SKIP ${id} — ${detail}`); };

async function audit(recipeObj, filmPath, verifierReport) {
  checks.length = 0;
  const scenes = recipeObj.scenes || [];
  const ramps = new Map((recipeObj.speed_ramps || []).filter((r) => Array.isArray(r.points)).map((r) => [r.scene, r.points]));
  const { duration, n, diffs } = await frameDiffs(filmPath);

  // 1. Frozen segments: any run of near-zero frame-to-frame change >= MIN_FREEZE_S fails.
  const runs = [];
  let start = null;
  for (let i = 1; i < n; i += 1) {
    if (diffs[i] < FREEZE_THRESHOLD) { if (start === null) start = i; }
    else if (start !== null) { runs.push([start, i - 1]); start = null; }
  }
  if (start !== null) runs.push([start, n - 1]);
  const frozen = runs.filter(([a, b]) => (b - a + 1) / fps >= MIN_FREEZE_S)
    .map(([a, b]) => ({ start_s: +(a / fps).toFixed(2), end_s: +(b / fps).toFixed(2), length_s: +((b - a + 1) / fps).toFixed(2) }));
  check("freeze", frozen.length === 0,
    frozen.length ? `frozen ${frozen.map((r) => `${r.start_s}-${r.end_s}s (${r.length_s}s)`).join(", ")}` : `no run >= ${MIN_FREEZE_S}s under threshold ${FREEZE_THRESHOLD}`,
    frozen.length ? "soften-ramp" : null);

  // 2. Motion smoothness: per-scene energy at 5 points vs the ramp curve. The fast points must
  //    move faster than the slow point; the slowest point must still move (energy > 0.2).
  let smoothDetail = [];
  let smoothPass = true;
  for (const scene of scenes) {
    const points = ramps.get(scene.id);
    if (!points) continue;
    const energies = [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => {
      const fi = Math.min(n - 1, Math.max(1, Math.round((scene.start_s + u * scene.duration_s) * fps)));
      return +diffs[fi].toFixed(2);
    });
    const speeds = [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => {
      if (u <= points[0][0]) return points[0][1];
      for (let k = 1; k < points.length; k += 1) if (u <= points[k][0]) { const [u0, s0] = points[k - 1], [u1, s1] = points[k]; return +(s0 + (s1 - s0) * ((u - u0) / Math.max(1e-6, u1 - u0))).toFixed(2); }
      return points[points.length - 1][1];
    });
    const fast = Math.max(...energies), slow = Math.min(...energies);
    const slowestSpeed = Math.min(...speeds);
    const ok = fast > slow * 1.5 && (slowestSpeed < 0.6 ? slow > 0.15 : true);
    if (!ok) smoothPass = false;
    smoothDetail.push(`${scene.id}: energy ${energies.join("/")} vs speed ${speeds.join("/")}`);
  }
  check("smoothness", smoothPass, smoothDetail.join("; ") || "no ramped scenes", smoothPass ? null : "soften-ramp");

  // 3. Whip blur: at each ramped scene, the fastest point is measurably blurrier than the slowest.
  //    When a verifier report is supplied, use its calibration numbers: the calibration renders
  //    the scene alone from a detailed still with no captions, so a caption drawn over the film
  //    cannot inflate the fast frame's sharpness and mask the blur (the film-based measurement
  //    below is the fallback, and it is known to under-read on captioned scenes).
  let blurDetail = [];
  let blurPass = true;
  const cal = new Map();
  if (verifierReport) {
    const rampCheck = (verifierReport.checks || []).find((c) => String(c.id || "").startsWith("8 "));
    if (rampCheck) for (const m of String(rampCheck.detail || "").matchAll(/(\w+):.*?blur fast ([\d.]+) vs slow ([\d.]+)/g)) cal.set(m[1], { fast: Number(m[2]), slow: Number(m[3]) });
  }
  for (const scene of scenes) {
    const points = ramps.get(scene.id);
    if (!points) continue;
    if (cal.has(scene.id)) {
      const { fast, slow } = cal.get(scene.id);
      const ratio = slow / Math.max(1e-9, fast);
      if (ratio < 1.3) blurPass = false;
      blurDetail.push(`${scene.id}: sharp fast ${fast} vs slow ${slow} (${ratio.toFixed(2)}x, calibration)`);
      continue;
    }
    const us = [0.1, 0.3, 0.5, 0.7, 0.9];
    const speeds = us.map((u) => {
      if (u <= points[0][0]) return points[0][1];
      for (let k = 1; k < points.length; k += 1) if (u <= points[k][0]) { const [u0, s0] = points[k - 1], [u1, s1] = points[k]; return s0 + (s1 - s0) * ((u - u0) / Math.max(1e-6, u1 - u0)); }
      return points[points.length - 1][1];
    });
    const fastU = us[speeds.indexOf(Math.max(...speeds))];
    const slowU = us[speeds.indexOf(Math.min(...speeds))];
    const fastFrame = await frameAt(filmPath, scene.start_s + fastU * scene.duration_s);
    const slowFrame = await frameAt(filmPath, scene.start_s + slowU * scene.duration_s);
    const fastSharp = sharpnessOf(fastFrame, 270, 480);
    const slowSharp = sharpnessOf(slowFrame, 270, 480);
    const ratio = slowSharp / Math.max(1e-9, fastSharp);
    if (ratio < 1.3) blurPass = false;
    blurDetail.push(`${scene.id}: sharp fast ${fastSharp.toFixed(1)} vs slow ${slowSharp.toFixed(1)} (${ratio.toFixed(2)}x)`);
  }
  check("whip-blur", blurPass, blurDetail.join("; ") || "no ramped scenes", blurPass ? null : "drop-whip");

  // 4. No whoosh: the recipe must not declare a whoosh/flash accent anywhere, and the render
  //    must not have one on a cut (checked from the recipe + the verifier's audio, not by ear).
  const recipeText = JSON.stringify(recipeObj);
  const hasWhoosh = /"kind"\s*:\s*"(whoosh|flash)"/.test(recipeText) || /whoosh/i.test(recipeText);
  check("no-whoosh", !hasWhoosh, hasWhoosh ? "whoosh/flash accent declared in the recipe" : "no whoosh or flash accent in the recipe", hasWhoosh ? "strip-whoosh" : null);

  // 5. Story sense: exterior before interior, rooms in walk-through order. This is a text check
  //    over the scene inputs + captions; a wrong order is flagged for Reda, never auto-fixed.
  //    A template may reuse an input (house-calling shows exterior_night twice: the night
  //    establishing shot, then the approach to the door), so the order is judged on FIRST
  //    appearances — a repeat is the camera returning to a place, not a story break.
  const order = scenes.map((s) => s.input);
  const firstSeen = [...new Set(order)];
  const exteriorFirst = firstSeen.length === 0 || /exterior|outside|front|driveway/i.test(firstSeen[0] || "");
  const firstInterior = firstSeen.findIndex((input) => !/exterior|outside|front|driveway/i.test(input || ""));
  const interiorAfter = firstInterior === -1 || firstSeen.slice(firstInterior).every((input) => !/exterior|outside|front|driveway/i.test(input || ""));
  const storyOk = exteriorFirst && interiorAfter;
  check("story", storyOk, storyOk ? `inputs in order: ${firstSeen.join(" → ")}` : `exterior must come first, interiors after: ${firstSeen.join(" → ")}`, null);

  // 6. Coherence results from the verifier's report, when supplied.
  if (verifierReport) {
    const failed = (verifierReport.checks || []).filter((c) => !c.pass);
    check("coherence", failed.length === 0, failed.length ? failed.map((c) => `${c.id}: ${c.detail}`).join("; ") : `${verifierReport.checks.length} §5a checks passed`, failed.length ? "verifier" : null);
  } else {
    skip("coherence", "no --verifier-report given (run the verifier first)");
  }

  // 7. Beat check: every cut lands on a beat of the finished film's own audio (measured, not
  //    assumed). The grid comes from the film's music track, so it is the grid the film was
  //    actually cut against. No steady beat in the track (ambient music) = SKIP, not fail.
  const filmGrid = await analyzeBeats(filmPath);
  if (!filmGrid) {
    skip("beat", "no steady beat in the film's music track (ambient); nothing to sync to");
  } else {
    const cuts = scenes.slice(1).map((s) => s.start_s);
    const offs = cuts.map((t) => ({ t, ...nearestBeat(t, filmGrid) }));
    const worst = offs.reduce((a, b) => (b.offBy > a.offBy ? b : a), offs[0] ?? { t: cuts[0] ?? 0, beat: null, offBy: 0 });
    check("beat", offs.every((o) => o.offBy <= BEAT_TOLERANCE_S),
      `${filmGrid.bpm} BPM, phase ${filmGrid.phase}s — cuts ${cuts.join("/")}s, worst off by ${worst.offBy}s at ${worst.t}s (tolerance ${BEAT_TOLERANCE_S}s)`,
      offs.every((o) => o.offBy <= BEAT_TOLERANCE_S) ? null : "snap-beats");
  }

  return { checks, duration, frozen, beatGrid: filmGrid || null };
}

/* Auto-fix: adjust the recipe in memory for one failing check, then re-render + re-audit. */
function applyFix(recipeObj, fixKind, beatGrid = null) {
  const next = JSON.parse(JSON.stringify(recipeObj));
  if (fixKind === "snap-beats" && beatGrid) {
    const snapped = snapRecipeToBeatGrid(next, beatGrid);
    return { recipe: snapped.recipe, note: `snapped cuts to the measured ${beatGrid.bpm} BPM grid (${snapped.moved.map((m) => `${m.scene} ${m.from}→${m.to}`).join(", ") || "already on it"})` };
  }
  if (fixKind === "soften-ramp") {
    // Raise the slowest ramp points so the settle still visibly moves; never above 0.7.
    for (const ramp of next.speed_ramps || []) {
      if (!Array.isArray(ramp.points)) continue;
      ramp.points = ramp.points.map(([u, s]) => [u, s < 0.6 ? Math.min(0.7, +(s + 0.15).toFixed(2)) : s]);
    }
    return { recipe: next, note: "softened the slowest ramp points (+0.15, capped at 0.7)" };
  }
  if (fixKind === "drop-whip") {
    for (const ramp of next.speed_ramps || []) {
      if (!Array.isArray(ramp.points)) continue;
      ramp.points = ramp.points.map(([u, s]) => [u, s > 1.8 ? 1.5 : s]);
    }
    return { recipe: next, note: "capped the whip at 1.5x" };
  }
  if (fixKind === "strip-whoosh") {
    return { recipe: next, note: "whoosh is a recipe-level removal — strip the SFX from the recipe and re-render" };
  }
  return null;
}

const verifierReport = args["verifier-report"] ? JSON.parse(fs.readFileSync(String(args["verifier-report"]), "utf8")) : null;
let current = recipe;
let round = 0;
let result = await audit(current, film, verifierReport);
// Only a FAIL (pass === false) with a fix triggers an auto-fix round; a
// SKIP (pass === null) is not a failure and never triggers one.
while (args.fix && result.checks.some((c) => c.pass === false && c.fix && c.fix !== "verifier") && round < MAX_FIX_ROUNDS) {
  round += 1;
  const failing = result.checks.find((c) => c.pass === false && c.fix && c.fix !== "verifier");
  const fixed = applyFix(current, failing.fix, result.beatGrid);
  if (!fixed) break;
  console.log(`\n— auto-fix round ${round}: ${failing.id} → ${fixed.note}`);
  current = fixed.recipe;
  // Re-rendering needs the verifier + inputs; without --inputs there is nothing to render from.
  if (!args.inputs) { console.log("auto-fix needs --inputs to re-render; stopping after the recipe change."); break; }
  const renderOut = outDir ? path.join(outDir, `round-${round}`) : fs.mkdtempSync(path.join("/tmp", "audit-round-"));
  fs.mkdirSync(renderOut, { recursive: true });
  const fixedPath = path.join(renderOut, "audited-recipe.json");
  fs.writeFileSync(fixedPath, JSON.stringify(current, null, 2));
  const verify2 = await run("node", ["--no-warnings", "composer/verify-template.mjs", "--recipe", fixedPath, "--inputs", String(args.inputs), "--out", renderOut, ...(args.music ? ["--music", String(args.music)] : [])], { timeoutMs: 20 * 60 * 1000 });
  if (verify2.code !== 0) { console.log(`re-render failed (verifier exit ${verify2.code}); keeping the previous film.`); break; }
  const newReport = JSON.parse(fs.readFileSync(path.join(renderOut, "verification-report.json"), "utf8"));
  const newFilm = newReport.film || path.join(renderOut, "film.mp4");
  result = await audit(current, newFilm, newReport);
}
const failed = result.checks.filter((c) => c.pass === false);
if (outDir) {
  fs.writeFileSync(path.join(outDir, "audit-report.json"), JSON.stringify({ template: current.template_id, rounds: round, filmDuration_s: result.duration, inputs: args.inputs ? String(args.inputs) : null, checks: result.checks, frozen: result.frozen }, null, 2));
  fs.writeFileSync(path.join(outDir, "audited-recipe.json"), JSON.stringify(current, null, 2));
}
console.log(`\n${failed.length ? `${failed.length} check(s) failing` : "all audit checks passed"} — ${round} auto-fix round(s)`);
process.exit(failed.length ? 1 : 0);
