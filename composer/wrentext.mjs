/* WrenCut text: finds the titles on a reference and how they come in, without
   keeping any of their words. For each title it keeps WHERE it sits, HOW big,
   WHEN it shows, whether it is in capitals, light or dark, and its entrance
   (fade, slide or pop). The words themselves are dropped: a template asks for
   new ones. Uses tesseract to find the text and ffmpeg to measure it. */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const WIDTH = 540;
const sh = (command, args, { timeoutMs = 120_000, binary = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const out = [], err = [];
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); }, timeoutMs);
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); const stdout = Buffer.concat(out); code === 0 ? resolve(binary ? stdout : stdout.toString("utf8")) : reject(new Error(`${command} failed: ${Buffer.concat(err).toString("utf8").slice(-200)}`)); });
});

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

/* The text lines tesseract finds in one picture, with their boxes (pixels). */
export async function readLines(png) {
  const tsv = await sh("tesseract", [png, "stdout", "--psm", "11", "tsv"], { timeoutMs: 60_000 });
  const lines = new Map();
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const conf = Number(c[10]), text = c[11].trim();
    if (!(conf >= 60) || !/[A-Za-z0-9]{2,}/.test(text)) continue;
    const key = `${c[2]}-${c[3]}-${c[4]}`;
    const box = { l: Number(c[6]), t: Number(c[7]), r: Number(c[6]) + Number(c[8]), b: Number(c[7]) + Number(c[9]) };
    const line = lines.get(key);
    if (line) { line.text += ` ${text}`; line.l = Math.min(line.l, box.l); line.t = Math.min(line.t, box.t); line.r = Math.max(line.r, box.r); line.b = Math.max(line.b, box.b); line.conf = Math.min(line.conf, conf); }
    else lines.set(key, { text, ...box, conf });
  }
  return [...lines.values()].map((line) => ({ text: line.text, x: (line.l + line.r) / 2, y: (line.t + line.b) / 2, w: line.r - line.l, h: line.b - line.t, conf: line.conf }));
}

const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const shared = [...new Set(a)].filter((ch) => b.includes(ch)).length;
  return shared / Math.max(new Set(a).size, new Set(b).size) >= 0.7 && Math.abs(a.length - b.length) <= Math.max(2, a.length * 0.3);
}

async function frames(file, dir, { from, length, fps }) {
  await fs.mkdir(dir, { recursive: true });
  await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...(from ? ["-ss", String(from)] : []), ...(length ? ["-t", String(length)] : []), "-i", file, "-an", "-vf", `fps=${fps},scale=${WIDTH}:-2`, path.join(dir, "f-%04d.png")]);
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".png")).sort().map((name, index) => ({ file: path.join(dir, name), t: (from || 0) + index / fps }));
}

async function pool(items, size, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i], i); } }));
  return out;
}

/* Grey picture of one box over a window of frames, for the contrast of the text over time. */
async function contrast(file, { from, length, fps, box }) {
  const x0 = Math.max(0, Math.round(box.x - box.w / 2)), y0 = Math.max(0, Math.round(box.y - box.h / 2));
  const w = Math.max(8, Math.min(Math.round(box.w), WIDTH - x0) & ~1), h = Math.max(8, Math.round(box.h) & ~1);
  const raw = await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(from), "-t", String(length), "-i", file, "-an", "-vf", `fps=${fps},scale=${WIDTH}:-2,crop=${w}:${h}:${x0}:${y0},format=gray`, "-f", "rawvideo", "-"], { binary: true });
  const size = w * h, count = Math.floor(raw.length / size);
  return Array.from({ length: count }, (_, f) => { let sum = 0, sq = 0; for (let i = 0; i < size; i += 1) { const v = raw[f * size + i]; sum += v; sq += v * v; } const mean = sum / size; return { std: Math.sqrt(Math.max(0, sq / size - mean * mean)), mean }; });
}

/* How a title comes in, from a dense look at its first moments. */
async function entrance(file, dir, track, height) {
  const fps = 12, from = Math.max(0, track.first - 0.5), length = 1.4;
  const grid = await frames(file, path.join(dir, `e-${track.id}`), { from, length, fps });
  const final = { x: median(track.boxes.map((b) => b.x)), y: median(track.boxes.map((b) => b.y)), w: median(track.boxes.map((b) => b.w)), h: median(track.boxes.map((b) => b.h)) };
  const seen = await pool(grid, 4, async (frame) => (await readLines(frame.file)).find((line) => similar(line.text, track.text)) || null);
  const levels = await contrast(file, { from, length, fps, box: { ...final, w: final.w * 1.1, h: final.h * 1.3 } }).catch(() => []);
  const n = Math.min(grid.length, levels.length);
  if (n < 6) return { start: track.first, fx: undefined };
  const base = levels[0].std, top = median(levels.slice(Math.max(0, n - 3), n).map((l) => l.std));
  if (top - base < 4) return { start: track.first, fx: undefined };
  const level = (i) => (levels[i].std - base) / (top - base);
  let at10 = -1, at50 = -1, at90 = -1;
  for (let i = 0; i < n; i += 1) { const v = level(i); if (at10 < 0 && v >= 0.1) at10 = i; if (at50 < 0 && v >= 0.5) at50 = i; if (at90 < 0 && v >= 0.9) at90 = i; }
  if (at50 < 0) return { start: track.first, fx: undefined };
  const start = round(Math.max(0, grid[at10 >= 0 ? at10 : at50].t));
  const firstSeen = seen.findIndex((line) => line);
  const box = firstSeen >= 0 ? seen[firstSeen] : null;
  const dx = box ? (box.x - final.x) / WIDTH : 0, dy = box ? (box.y - final.y) / height : 0, scale = box ? box.w / final.w : 1;
  const settle = Math.max(0.15, Math.min(1, (grid[Math.min(n - 1, at90 >= 0 ? at90 : at50 + 2)].t - grid[at10 >= 0 ? at10 : at50].t) + 1 / fps));
  if (box && (Math.abs(dx) > 0.03 || Math.abs(dy) > 0.03)) return { start, fx: { type: "slide", dur: round(settle), dx: round(dx), dy: round(dy) } };
  if (box && scale < 0.86) return { start, fx: { type: "pop", dur: round(settle), from: round(scale) } };
  if (at90 - at10 >= 2) return { start, fx: { type: "fade", dur: round(settle) } };
  return { start, fx: undefined };
}

/* The titles of a reference as slots: no words. */
export async function analyzeText(file, { duration, width, height, workDir, onStage = () => {} }) {
  onStage("text");
  const fps = Math.min(4, Math.max(1, 240 / Math.max(1, duration)));
  const dir = path.join(workDir, "text");
  const grid = await frames(file, path.join(dir, "g"), { fps });
  const scale = WIDTH / width, frameH = height * scale;
  const reads = await pool(grid, 4, async (frame) => readLines(frame.file).catch(() => []));
  const tracks = [];
  reads.forEach((lines, index) => {
    const t = grid[index].t;
    for (const line of lines) {
      let track = tracks.find((item) => !item.closed && t - item.last <= 2.5 / fps && Math.abs(item.cy - line.y) < 0.05 * frameH && similar(item.text, line.text));
      if (!track) { track = { id: tracks.length, text: line.text, cy: line.y, first: t, last: t, boxes: [], texts: [], conf: [] }; tracks.push(track); }
      track.last = t; track.cy = line.y; track.boxes.push(line); track.texts.push(line.text); track.conf.push(line.conf);
    }
  });
  const kept = tracks.filter((track) => track.last - track.first >= 0.45 && track.boxes.length >= 2 && median(track.conf) >= 70)
    .sort((a, b) => (b.last - b.first) - (a.last - a.first)).slice(0, 8);
  const out = [];
  for (const track of kept) {
    const x = median(track.boxes.map((b) => b.x)) / WIDTH, y = median(track.boxes.map((b) => b.y)) / frameH, h = median(track.boxes.map((b) => b.h)) / frameH;
    const caps = track.texts.filter((text) => /[A-Z]/.test(text) && text === text.toUpperCase()).length > track.texts.length / 2;
    const motion = await entrance(file, dir, track, frameH).catch(() => ({ start: track.first, fx: undefined }));
    out.push({ start: round(Math.min(motion.start, track.last)), end: round(Math.min(duration, track.last + 1 / fps)), x: round(x), y: round(y), h: round(h), caps, ...(motion.fx ? { fx: motion.fx } : {}) });
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  return out.sort((a, b) => a.start - b.start || a.y - b.y);
}
