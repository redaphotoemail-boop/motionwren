/* WrenCut: reads a reference edit and writes its recipe, then renders the
   recipe over any clips. Nothing from the reference itself is kept — only
   numbers: how long each shot is, how the camera moves in it, how shots join,
   and the colour look. Pure ffmpeg + a little arithmetic, no other tools. */

import { spawn } from "node:child_process";
import { analyzeAudio } from "./wrenaudio.mjs";

const sh = (command, args, { timeoutMs = 10 * 60 * 1000, binary = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const out = [], err = [];
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); }, timeoutMs);
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); const stdout = Buffer.concat(out); code === 0 ? resolve({ stdout: binary ? stdout : stdout.toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }) : reject(new Error(`${command} failed: ${Buffer.concat(err).toString("utf8").slice(-300)}`)); });
});

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/* ---------- reading the reference ---------- */

async function frameStats(file) {
  // One pass at a small size: how different each frame is from the last, and its brightness and colour.
  const { stdout } = await sh("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "scale=160:-2,select='gte(scene,0)',signalstats,metadata=print:file=-", "-f", "null", "-"]);
  const frames = [];
  let current = null;
  for (const line of stdout.split("\n")) {
    const head = /^frame:\d+\s+pts:\S+\s+pts_time:([\d.]+)/.exec(line);
    if (head) { current = { t: Number(head[1]) }; frames.push(current); continue; }
    const kv = /^lavfi\.(\S+)=(\S+)$/.exec(line.trim());
    if (kv && current) current[kv[1]] = Number(kv[2]);
  }
  return frames.map((frame) => ({ t: frame.t, score: frame["scene_score"] ?? 0, y: frame["signalstats.YAVG"] ?? 0, u: frame["signalstats.UAVG"] ?? 128, v: frame["signalstats.VAVG"] ?? 128, sat: frame["signalstats.SATAVG"] ?? 30 }));
}

/* Shots and how they join: a hard cut is one big jump; a dissolve is several smaller ones in a row;
   a flash is a brief brightness spike right at the join. */
function findJoins(frames, duration) {
  const joins = [];
  const step = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 1 / 30;
  for (let i = 1; i < frames.length - 1; i += 1) {
    const f = frames[i];
    if (f.score >= 0.32 && f.score >= frames[i - 1].score && f.score >= frames[i + 1].score) joins.push({ at: f.t, type: "cut", dur: 0.04 });
  }
  // Dissolves: a run of frames with moderate change whose total is big.
  let i = 1;
  while (i < frames.length - 1) {
    if (frames[i].score >= 0.04 && frames[i].score < 0.32) {
      let j = i, sum = 0;
      while (j < frames.length && frames[j].score >= 0.04 && frames[j].score < 0.32) { sum += frames[j].score; j += 1; }
      const length = j - i;
      if (length >= 4 && sum >= 0.45 && !joins.some((join) => join.at > frames[i].t - 0.3 && join.at < frames[j - 1].t + 0.3)) {
        joins.push({ at: (frames[i].t + frames[j - 1].t) / 2, type: "dissolve", dur: round(clamp(length * step, 0.15, 0.9)) });
      }
      i = j;
    } else i += 1;
  }
  joins.sort((a, b) => a.at - b.at);
  // Flash: brightness well above its surroundings within a moment of a join.
  const median = (list) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
  for (const join of joins) {
    const near = frames.filter((frame) => Math.abs(frame.t - join.at) <= 0.12);
    const around = frames.filter((frame) => Math.abs(frame.t - join.at) > 0.2 && Math.abs(frame.t - join.at) <= 0.8);
    if (near.length && around.length && Math.max(...near.map((frame) => frame.y)) - median(around.map((frame) => frame.y)) >= 35) { join.type = "flash"; join.dur = 0.16; }
  }
  // Drop joins too close together (one real join seen twice) and any at the very ends.
  const kept = [];
  for (const join of joins) {
    if (join.at < 0.25 || join.at > duration - 0.25) continue;
    if (kept.length && join.at - kept[kept.length - 1].at < 0.25) continue;
    kept.push(join);
  }
  return kept;
}

const W = 64, H = 36;
async function grayFrame(file, t) {
  const { stdout } = await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"], { binary: true, timeoutMs: 60_000 });
  return Uint8Array.from(stdout);
}
const sample = (img, x, y) => {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return -1;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return img[y0 * W + x0] * (1 - fx) * (1 - fy) + img[y0 * W + x1] * fx * (1 - fy) + img[y1 * W + x0] * (1 - fx) * fy + img[y1 * W + x1] * fx * fy;
};

/* How the camera moved between the first and last picture of a shot: a zoom (z, >1 pushes in)
   and a slide (dx, dy as fractions of the frame), found by trying many and keeping the closest match. */
export function estimateMove(a, b) {
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const cost = (z, dx, dy) => {
    let sum = 0, n = 0;
    for (let y = 3; y < H - 3; y += 1) for (let x = 3; x < W - 3; x += 1) {
      const v = sample(a, cx + (x - cx) / z - dx * W, cy + (y - cy) / z - dy * H);
      if (v < 0) continue;
      const d = v - b[y * W + x]; sum += d * d; n += 1;
    }
    return n > 400 ? sum / n : Infinity;
  };
  const base = cost(1, 0, 0);
  let best = { z: 1, dx: 0, dy: 0, c: base };
  for (let z = 0.72; z <= 1.45001; z += 0.025) for (let dx = -0.16; dx <= 0.16001; dx += 0.02) for (let dy = -0.12; dy <= 0.12001; dy += 0.02) {
    const c = cost(z, dx, dy);
    if (c < best.c) best = { z, dx, dy, c };
  }
  if (!Number.isFinite(base) || best.c > base * 0.8 || (Math.abs(best.z - 1) < 0.03 && Math.abs(best.dx) < 0.02 && Math.abs(best.dy) < 0.02)) return { z: 1, dx: 0, dy: 0 };
  return { z: round(best.z), dx: round(best.dx), dy: round(best.dy) };
}

/* A move as it will be drawn: the picture is always at least full size (zoom 1 or more). */
/* How fast the picture moves through a shot, over time: the size of the change between frames. A shot whose
   movement swells and fades (a speed ramp) shows as a curve; steady footage stays flat and gets no curve.
   Returns [[u, speed], …] (u = 0..1 along the shot, speed relative to the shot's own average) or null. */
async function speedCurve(file, start, end) {
  const length = end - start;
  if (length < 0.5) return null;
  const fps = 20, w = 64, h = 112;
  let raw;
  try { raw = (await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(start + 0.06), "-t", String(Math.max(0.3, length - 0.12)), "-i", file, "-an", "-vf", `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-"], { binary: true, timeoutMs: 60_000 })).stdout; } catch { return null; }
  const size = w * h, count = Math.floor(raw.length / size);
  if (count < 7) return null;
  const energy = [];
  for (let f = 1; f < count; f += 1) { let sum = 0; for (let i = 0; i < size; i += 1) sum += Math.abs(raw[f * size + i] - raw[(f - 1) * size + i]); energy.push(sum / size); }
  // Smooth over three frames.
  const smooth = energy.map((_, i) => (energy[Math.max(0, i - 1)] + energy[i] + energy[Math.min(energy.length - 1, i + 1)]) / 3);
  const sorted = [...smooth].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)], high = sorted[Math.floor(sorted.length * 0.9)], mid = sorted[Math.floor(sorted.length / 2)];
  if (high < 0.45 || high / Math.max(low, 0.25 * mid, 0.2) < 2.3) return null; // too still, or too even
  const at = (u) => smooth[Math.min(smooth.length - 1, Math.max(0, Math.round(u * (smooth.length - 1))))];
  // Movement energy flattens out at high speed, so the curve is stretched a little to match how the ramp is felt.
  const points = [0, 0.2, 0.4, 0.6, 0.8, 1].map((u) => [u, (at(u) / mid) ** 1.35]);
  const mean = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return points.map(([u, v]) => [u, round(clamp(v / mean, 0.3, 3))]);
}

const moveToSlot = (move) => ({ zoom: move.z >= 1 ? [1, round(move.z)] : [round(1 / move.z), 1], pan: [round(move.dx), round(move.dy)] });

export async function analyzeVideo(file, { duration, fps, width, height, workDir, onStage = () => {} }) {
  onStage("reading");
  const frames = await frameStats(file);
  if (frames.length < 10) throw new Error("That video is too short to read.");
  const joins = findJoins(frames, duration);
  const bounds = [0, ...joins.map((join) => join.at), duration];
  onStage("moves");
  const slots = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i], end = bounds[i + 1], length = end - start;
    const pad = Math.max(0.12, (i > 0 ? joins[i - 1].dur : 0) / 2 + 0.05);
    let move = { z: 1, dx: 0, dy: 0 };
    if (length > 0.7) {
      try { move = estimateMove(await grayFrame(file, start + pad), await grayFrame(file, end - Math.max(0.12, (i < joins.length ? joins[i].dur : 0) / 2 + 0.05))); } catch { /* a shot that cannot be measured stays still */ }
    }
    const speed = await speedCurve(file, start + pad, end - 0.05).catch(() => null);
    slots.push({ dur: round(length), ...moveToSlot(move), ...(speed ? { speed } : {}) });
  }
  // The look: warmth from the blue/red balance, richness from saturation.
  const mean = (key) => frames.reduce((sum, frame) => sum + frame[key], 0) / frames.length;
  const warmth = ((mean("v") - 128) - (mean("u") - 128)) / 2;
  const grade = { warmth: round(clamp(warmth * 0.012, -0.1, 0.1)), saturation: round(clamp(mean("sat") / 34, 0.85, 1.35)) };
  // The sound: tempo/tone of the music and the accents on the cuts, as prompts (the audio itself is never kept).
  onStage("sound");
  let audio;
  try { audio = await analyzeAudio(file, { duration, joins: joins.map((join) => ({ at: join.at, type: join.type })) }); } catch { /* a recipe without sound is still a recipe */ }
  return {
    ...(audio ? { audio: { ...(audio.music ? { music: audio.music } : {}), sfx: audio.sfx.map((item) => ({ join: item.join, kind: item.kind, lead: item.lead, prompt: item.prompt })) } } : {}),
    version: 1, duration: round(duration), fps: Math.round(fps), aspect: height > width ? "vertical" : width > height ? "horizontal" : "square",
    slots,
    // Only the joins that were actually kept between shots.
    joins: joins.map((join) => ({ type: join.type, dur: join.dur })),
    grade,
  };
}

/* ---------- drawing a recipe over clips ---------- */

/* Total film length of a recipe: the shots end to end, less the overlap of each join. */
export function recipeDuration(recipe) {
  const overlap = recipe.joins.reduce((sum, join) => sum + joinOverlap(join), 0);
  return round(recipe.slots.reduce((sum, slot) => sum + slot.dur, 0) - overlap);
}
const joinOverlap = (join) => join.type === "cut" ? 0.04 : join.type === "flash" ? 0.16 : join.dur;

export function validRecipe(recipe) {
  if (!recipe || recipe.version !== 1 || !Array.isArray(recipe.slots) || !Array.isArray(recipe.joins)) return "The recipe is not readable.";
  if (recipe.slots.length < 1 || recipe.slots.length > 60 || recipe.joins.length !== recipe.slots.length - 1) return "The recipe's shots and joins do not match.";
  for (const slot of recipe.slots) {
    if (!(slot.dur >= 0.3 && slot.dur <= 30)) return "A shot's length is out of range.";
    if (!Array.isArray(slot.zoom) || slot.zoom.length !== 2 || slot.zoom.some((z) => !(z >= 1 && z <= 1.6))) return "A shot's zoom is out of range.";
    if (!Array.isArray(slot.pan) || slot.pan.length !== 2 || slot.pan.some((p) => !(Math.abs(p) <= 0.3))) return "A shot's slide is out of range.";
    if (slot.speed !== undefined && !(Array.isArray(slot.speed) && slot.speed.length >= 2 && slot.speed.length <= 8 && slot.speed.every((point) => Array.isArray(point) && point[0] >= 0 && point[0] <= 1 && point[1] >= 0.2 && point[1] <= 4))) return "A shot's speed ramp is out of range.";
  }
  for (const [i, join] of recipe.joins.entries()) {
    if (!["cut", "dissolve", "flash"].includes(join.type) || !(join.dur >= 0.02 && join.dur <= 1.2)) return "A join is out of range.";
    if (joinOverlap(join) >= Math.min(recipe.slots[i].dur, recipe.slots[i + 1].dur)) return "A join is longer than its shots.";
  }
  return "";
}

/* The slices of a ramped shot. speed = [[u, s], …]: s is how fast the source runs at u (0..1 along the shot); strength
   blends toward steady (1 = as read). Fast slices are blurred by blending neighbouring frames; slow ones are
   smoothed by making in-between frames, so slow motion does not stutter. */
const SLICES = 8;
export function rampHead({ index, speed, d, start, fps, strength = 1 }) {
  const total = d + 0.2;
  const at = (u) => {
    const pts = speed;
    if (u <= pts[0][0]) return pts[0][1];
    for (let k = 1; k < pts.length; k += 1) if (u <= pts[k][0]) { const [u0, s0] = pts[k - 1], [u1, s1] = pts[k]; return s0 + (s1 - s0) * ((u - u0) / Math.max(1e-6, u1 - u0)); }
    return pts[pts.length - 1][1];
  };
  const lines = [], labels = [];
  const sliceLen = total / SLICES;
  let source = 0;
  const parts = [];
  for (let k = 0; k < SLICES; k += 1) {
    const raw = at(Math.min(1, ((k + 0.5) * sliceLen) / d));
    const s = 1 + (raw - 1) * strength;
    parts.push({ s, from: source, to: source + sliceLen * s });
    source += sliceLen * s;
  }
  const pre = `[${index}:v]trim=start=${start.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${Math.ceil(source + 1)},split=${SLICES}${parts.map((_, k) => `[rp${index}_${k}]`).join("")}`;
  lines.push(pre);
  parts.forEach((part, k) => {
    const blur = part.s > 1.12 ? `,tmix=frames=${Math.min(8, Math.max(3, Math.round(part.s * 2.4)))}` : ""; // motion blur: fast parts smear across neighbouring frames
    const smooth = part.s < 0.75 ? `,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1:scd=none` : "";
    lines.push(`[rp${index}_${k}]trim=start=${part.from.toFixed(4)}:end=${part.to.toFixed(4)},setpts=PTS-STARTPTS${blur},setpts=PTS/${part.s.toFixed(4)}${smooth},fps=${fps}[rq${index}_${k}]`);
    labels.push(`[rq${index}_${k}]`);
  });
  lines.push(`${labels.join("")}concat=n=${SLICES}:v=1:a=0,trim=duration=${total.toFixed(3)},setpts=PTS-STARTPTS[rr${index}]`);
  return { lines, label: `rr${index}` };
}

/* A speed-ramped shot on its own: the clip is re-timed (and blurred / smoothed) into a short file of exactly the shot's
   length plus its overlap. Doing this one shot at a time, before the film is joined, keeps the editor's memory low: all
   shots ramped inside one big graph held every shot's frames at once and ran the editor out of memory on long films. */
export function rampClipArgs({ input, output, speed, d, start, fps }) {
  const ramp = rampHead({ index: 0, speed, d, start: Math.max(0, start || 0), fps, strength: 1 });
  return ["-y", "-i", input, "-filter_complex", ramp.lines.join(";"), "-map", `[${ramp.label}]`, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", "-r", String(fps), output];
}

/* The filter graph for a recipe: clip i (input i) becomes shot i, moved as the recipe says, then all joined.
   `starts[i]` is where in clip i the shot begins. Returns the graph lines and the label of the joined picture. */
export function recipeChain({ recipe, width, height, fps, starts = [], strength = 1 }) {
  const filters = [];
  const n = recipe.slots.length;
  const SS = 2; // drawn at double size so slow moves do not shimmer
  recipe.slots.forEach((slot, i) => {
    const d = slot.dur;
    const z0 = 1 + (slot.zoom[0] - 1) * strength, z1 = 1 + (slot.zoom[1] - 1) * strength;
    const px = slot.pan[0] * strength, py = slot.pan[1] * strength;
    const w2 = width * SS, h2 = height * SS;
    const u = `(t/${d.toFixed(3)})`;
    const z = `(${z0.toFixed(4)}+(${(z1 - z0).toFixed(4)})*${u})`;
    // A speed ramp re-times the shot through a few short slices (each at its own speed), blurred where it speeds up
    // and smoothed where it slows down; a shot without one is untouched.
    const ramp = slot.speed ? rampHead({ index: i, speed: slot.speed, d, start: Math.max(0, starts[i] || 0), fps, strength: 1 }) : null;
    if (ramp) filters.push(...ramp.lines);
    const head = ramp ? `[${ramp.label}]` : `[${i}:v]trim=start=${Math.max(0, starts[i] || 0).toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=duration=${(d + 0.2).toFixed(3)},`;
    filters.push(`${head}fps=${fps},scale=${w2}:${h2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w2}:${h2},`
      + `scale=w='${w2}*${z}':h='${h2}*${z}':eval=frame:flags=bilinear,`
      + `crop=${w2}:${h2}:x='min(max((in_w-${w2})/2+${(px * w2).toFixed(2)}*(${u}-0.5)*-1,0),in_w-${w2})':y='min(max((in_h-${h2})/2+${(py * h2).toFixed(2)}*(${u}-0.5)*-1,0),in_h-${h2})',`
      + `scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p[s${i}]`);
  });
  let last = "s0", acc = recipe.slots[0].dur;
  for (let i = 1; i < n; i += 1) {
    const join = recipe.joins[i - 1];
    const x = joinOverlap(join);
    const transition = join.type === "flash" ? "fadewhite" : "fade";
    filters.push(`[${last}][s${i}]xfade=transition=${transition}:duration=${x.toFixed(3)}:offset=${(acc - x).toFixed(3)}[j${i}]`);
    last = `j${i}`; acc += recipe.slots[i].dur - x;
  }
  const g = recipe.grade;
  if (g && (g.warmth || (g.saturation && g.saturation !== 1))) {
    const warm = clamp(g.warmth, -0.1, 0.1);
    filters.push(`[${last}]colorbalance=rs=${(warm * 0.6).toFixed(3)}:bs=${(-warm * 0.7).toFixed(3)}:rm=${warm.toFixed(3)}:bm=${(-warm).toFixed(3)}:rh=${(warm * 0.6).toFixed(3)}:bh=${(-warm * 0.6).toFixed(3)},eq=saturation=${clamp(g.saturation || 1, 0.85, 1.35).toFixed(3)}[graded]`);
    last = "graded";
  }
  return { filters, last, total: round(acc) };
}

/* Which clip fills each shot, and where in it the shot starts, when there are fewer clips than shots. */
export function assignClips(recipe, clipDurations) {
  const uses = clipDurations.map(() => 0);
  const total = clipDurations.map((_, index) => recipe.slots.filter((__, slot) => slot % clipDurations.length === index).length);
  return recipe.slots.map((slot, index) => {
    const clip = index % clipDurations.length;
    const occurrence = uses[clip]++;
    const room = Math.max(0, clipDurations[clip] - slot.dur - 0.2);
    return { clip, start: round(total[clip] > 1 ? room * (occurrence / (total[clip] - 1)) : 0) };
  });
}
