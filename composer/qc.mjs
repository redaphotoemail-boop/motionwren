/* Free mechanical quality check for a finished film.
   Samples the film at a few frames a second, small and grey, and measures
   what a person would notice first: a soft picture, black or frozen stretches,
   sudden jumps and flicker. Pure maths on the frames, no AI, no cost.
   It never changes the film and never fails it: it only reports. */
import { spawn } from "node:child_process";

export const QC_FPS = 4;

/* Raw grey frames, width×height bytes each. */
export function sampleFrames(file, { width, height, fps = QC_FPS, timeoutMs = 4 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-i", file, "-vf", `fps=${fps},scale=${width}:${height}:flags=area,format=gray`, "-f", "rawvideo", "-"];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let size = 0; let stderr = "";
    child.stdout.on("data", (data) => { chunks.push(data); size += data.length; if (size > 400e6) child.kill("SIGKILL"); });
    child.stderr.on("data", (data) => { stderr += data; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("The quality check took too long.")); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !size) return reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-300)}`));
      const all = Buffer.concat(chunks, size); const each = width * height; const frames = [];
      for (let at = 0; at + each <= all.length; at += each) frames.push(all.subarray(at, at + each));
      resolve(frames);
    });
  });
}

const median = (values) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

/* Variance of the Laplacian: high on a crisp picture, low on a soft one. */
export function sharpness(frame, w, h) {
  let sum = 0; let sum2 = 0; let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const v = 4 * frame[i] - frame[i - 1] - frame[i + 1] - frame[i - w] - frame[i + w];
      sum += v; sum2 += v * v; n += 1;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

const meanOf = (frame) => { let s = 0; for (let i = 0; i < frame.length; i += 1) s += frame[i]; return s / frame.length; };
const differ = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; };

/* frames: grey buffers sampled at `fps`. Returns the numbers and the flags. */
export function analyzeFrames(frames, { width, height, fps = QC_FPS, duration, boundaries = [], hasCards = false } = {}) {
  const flags = [];
  if (frames.length < 3) return { metrics: { frames: frames.length }, flags: [{ level: "warn", code: "short", message: "Too few frames to check." }] };
  const dur = duration || frames.length / fps;
  const at = (i) => Math.round((i / fps) * 10) / 10;
  const edge = hasCards ? 1.2 : 0.6; // cards and fades are dark or still on purpose
  const inside = (i) => at(i) > edge && at(i) < dur - edge;

  const sharp = frames.map((f) => sharpness(f, width, height));
  const luma = frames.map(meanOf);
  const diffs = []; for (let i = 1; i < frames.length; i += 1) diffs.push(differ(frames[i - 1], frames[i]));
  const sharpMid = median(sharp.filter((_, i) => inside(i)));
  const base = median(diffs) || 0.01;

  // 1. Soft picture
  if (sharpMid < 6) flags.push({ level: "fail", code: "soft", message: `The picture is very soft (sharpness ${sharpMid.toFixed(1)}).` });
  else if (sharpMid < 14) flags.push({ level: "warn", code: "soft", message: `The picture is a little soft (sharpness ${sharpMid.toFixed(1)}).` });

  // 2. Black stretches in the middle of the film
  const black = luma.map((v, i) => (inside(i) && v < 10 ? i : -1)).filter((i) => i >= 0);
  if (black.length >= 2) flags.push({ level: "fail", code: "black", at: at(black[0]), message: `Black picture around ${at(black[0])} s (${(black.length / fps).toFixed(1)} s).` });

  // 3. Frozen stretch
  let run = 0; let runStart = 0; let longest = 0; let longestAt = 0;
  for (let i = 0; i < diffs.length; i += 1) {
    if (diffs[i] < 0.04) { if (!run) runStart = i; run += 1; if (run > longest) { longest = run; longestAt = runStart; } } else run = 0;
  }
  if (longest / fps >= 2.5) flags.push({ level: "warn", code: "frozen", at: at(longestAt), message: `The picture stands still for ${(longest / fps).toFixed(1)} s around ${at(longestAt)} s.` });

  // 4. Sudden jump (away from the planned scene changes)
  const near = (t) => boundaries.some((b) => Math.abs(b - t) <= 0.6);
  const jumps = [];
  for (let i = 0; i < diffs.length; i += 1) {
    const t = at(i + 1);
    if (near(t) || t < 0.5 || t > dur - 0.5) continue;
    if (diffs[i] > Math.max(28, base * 12)) jumps.push({ t, diff: Math.round(diffs[i] * 10) / 10 });
  }
  if (jumps.length) flags.push({ level: "fail", code: "jump", at: jumps[0].t, message: `The picture jumps suddenly around ${jumps[0].t} s${jumps.length > 1 ? ` (and ${jumps.length - 1} more)` : ""}.` });

  // 5. Flicker: brightness swinging up and down frame after frame
  let swing = 0; let worst = 0; let worstAt = 0;
  for (let i = 2; i < luma.length; i += 1) {
    const a = luma[i - 1] - luma[i - 2]; const b = luma[i] - luma[i - 1];
    if (inside(i) && a * b < 0 && Math.min(Math.abs(a), Math.abs(b)) > 3) { swing += 1; if (swing > worst) { worst = swing; worstAt = i; } } else swing = 0;
  }
  if (worst >= 4) flags.push({ level: "warn", code: "flicker", at: at(worstAt), message: `The brightness flickers around ${at(worstAt)} s.` });

  return {
    metrics: { frames: frames.length, sharpness: Math.round(sharpMid * 10) / 10, medianMotion: Math.round(base * 100) / 100, maxMotion: Math.round(Math.max(...diffs) * 10) / 10, darkestFrame: Math.round(Math.min(...luma.filter((_, i) => inside(i))) * 10) / 10 },
    flags,
  };
}

/* The whole check for one finished film. Never throws. */
export async function qualityCheck(file, { width, height, duration, sceneSeconds, crossfade = 0, hasCards = false }) {
  try {
    const scale = 480 / Math.max(width, height);
    const w = Math.max(64, Math.round((width * scale) / 2) * 2); const h = Math.max(64, Math.round((height * scale) / 2) * 2);
    const frames = await sampleFrames(file, { width: w, height: h });
    const step = sceneSeconds ? Math.max(1, sceneSeconds - crossfade) : 0;
    const boundaries = []; if (step) for (let t = step; t < duration - 0.5; t += step) boundaries.push(Math.round(t * 10) / 10);
    const { metrics, flags } = analyzeFrames(frames, { width: w, height: h, duration, boundaries, hasCards });
    const status = flags.some((f) => f.level === "fail") ? "fail" : flags.length ? "warn" : "pass";
    return { status, flags, metrics, checkedAt: Date.now() };
  } catch (error) {
    return { status: "error", flags: [], error: String(error?.message || error).slice(0, 300), checkedAt: Date.now() };
  }
}

/* A few evenly spaced stills (JPEG, 768 px on the long side) for the AI review. */
export async function extractStills(file, dir, { duration, count = 4 }) {
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const t = Math.max(0.2, Math.min(duration - 0.2, ((i + 0.5) / count) * duration));
    const out = `${dir}/still-${i + 1}.jpg`;
    await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'", "-q:v", "3", out], { stdio: "ignore" });
      child.on("error", reject); child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("still failed"))));
    });
    made.push(out);
  }
  return made;
}

/* The straightness guard for the hybrid (AI on top of a measured camera move).
   The mechanical render has the right geometry; the AI clip must keep it.
   Compare the edge pictures (walls, door frames, rooflines) of both, frame by
   frame: when lines have bent, moved or melted the edges stop lining up and
   the score drops. Returns { held, mean, min }. */
function edgeMap(frame, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x;
    const gx = frame[i - w + 1] + 2 * frame[i + 1] + frame[i + w + 1] - frame[i - w - 1] - 2 * frame[i - 1] - frame[i + w - 1];
    const gy = frame[i + w - 1] + 2 * frame[i + w] + frame[i + w + 1] - frame[i - w - 1] - 2 * frame[i - w] - frame[i - w + 1];
    out[i] = Math.hypot(gx, gy);
  }
  return out;
}
function blur(map, w, h, passes = 2) {
  let a = map; let b = new Float32Array(map.length);
  for (let p = 0; p < passes; p += 1) {
    for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x; let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) s += a[i + dy * w + dx];
      b[i] = s / 9;
    }
    [a, b] = [b, a];
  }
  return a;
}
function correlation(a, b) {
  let ma = 0; let mb = 0; for (let i = 0; i < a.length; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= a.length;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i += 1) { const x = a[i] - ma; const y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function structureScore(framesA, framesB, w, h) {
  const n = Math.min(framesA.length, framesB.length);
  const scores = [];
  for (let i = 0; i < n; i += 1) scores.push(correlation(blur(edgeMap(framesA[i], w, h), w, h), blur(edgeMap(framesB[i], w, h), w, h)));
  const mean = scores.reduce((s, v) => s + v, 0) / (scores.length || 1);
  return { mean: Math.round(mean * 1000) / 1000, min: Math.round(Math.min(...scores, 1) * 1000) / 1000, frames: n };
}

export const STRUCTURE_MEAN = 0.78;
export const STRUCTURE_MIN = 0.6;

export async function structureHeld(aiFile, refFile, { width, height }) {
  const scale = 320 / Math.max(width, height);
  const w = Math.max(64, Math.round(width * scale)); const h = Math.max(64, Math.round(height * scale));
  const [a, b] = await Promise.all([sampleFrames(aiFile, { width: w, height: h, fps: 3 }), sampleFrames(refFile, { width: w, height: h, fps: 3 })]);
  const score = structureScore(a, b, w, h);
  return { ...score, held: score.mean >= STRUCTURE_MEAN && score.min >= STRUCTURE_MIN };
}
