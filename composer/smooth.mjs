/* Smoothness check: is the camera move steady, frame after frame?
   Pure maths on the film's own frames (no AI, no guessing, no cost).
   For every pair of neighbouring frames it measures how far the picture
   slid sideways and up/down (to a fraction of a pixel, from the brightness
   profile of each frame). A smooth camera move changes that slide slowly;
   a shaky one wobbles it from frame to frame. The shake is the part of the
   slide that is left after the slow trend is taken away.
   Scene changes and crossfades are skipped. */

const SHIFT = 4; // largest slide per frame we look for, in analysis pixels

function profile(frame, w, h, axis) {
  const n = axis === "x" ? w : h;
  const out = new Float64Array(n);
  if (axis === "x") { for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[x] += frame[y * w + x]; }
  else { for (let y = 0; y < h; y += 1) { let s = 0; for (let x = 0; x < w; x += 1) s += frame[y * w + x]; out[y] = s; } }
  // keep the detail, drop the slow brightness: subtract a moving average
  const detail = new Float64Array(n); const r = 8;
  for (let i = 0; i < n; i += 1) { let s = 0; let c = 0; for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j += 1) { s += out[j]; c += 1; } detail[i] = out[i] - s / c; }
  return detail;
}

const at = (p, x) => { const i = Math.floor(x); const f = x - i; return p[i] * (1 - f) + p[i + 1] * f; };

/* How far profile b is slid relative to a, in pixels. A coarse whole-pixel match first, then a few steps of
   least-squares refinement (Lucas–Kanade), which is accurate to a small fraction of a pixel. */
export function slide(a, b) {
  const n = a.length; let best = -Infinity; let bestAt = 0;
  for (let s = -SHIFT; s <= SHIFT; s += 1) {
    let num = 0; let da = 0; let db = 0;
    for (let i = SHIFT + 1; i < n - SHIFT - 1; i += 1) { const x = a[i]; const y = b[i + s]; num += x * y; da += x * x; db += y * y; }
    const score = da && db ? num / Math.sqrt(da * db) : 0;
    if (score > best) { best = score; bestAt = s; }
  }
  let shift = bestAt;
  const lo = SHIFT + 2; const hi = n - SHIFT - 3;
  for (let step = 0; step < 5; step += 1) {
    let num = 0; let den = 0;
    for (let i = lo; i < hi; i += 1) {
      const x = i + shift; if (x < 1 || x > n - 3) continue;
      const g = (at(b, x + 0.5) - at(b, x - 0.5)); // slope of b at the matched place
      const e = at(b, x) - a[i]; // what is still different
      num += g * e; den += g * g;
    }
    if (!den) break;
    const delta = -num / den;
    shift += Math.max(-1, Math.min(1, delta));
    if (Math.abs(delta) < 0.002) break;
  }
  return { shift, fit: best };
}

const mean = (values) => values.reduce((s, v) => s + v, 0) / (values.length || 1);

/* Residual of a series after a slow trend (a moving average over `win` frames) is removed. */
export function residual(series, win = 9) {
  const half = Math.floor(win / 2); const out = [];
  for (let i = 0; i < series.length; i += 1) {
    const from = Math.max(0, i - half); const to = Math.min(series.length - 1, i + half);
    const around = []; for (let j = from; j <= to; j += 1) if (j !== i) around.push(series[j]);
    around.sort((p, q) => p - q);
    out.push(series[i] - around[Math.floor(around.length / 2)]);
  }
  return out;
}

/* frames: grey buffers at the film's own frame rate. skip(t) → true for moments to leave out (scene changes, fades).
   Returns { jitter, worst, spikes, scenes… } with sizes as a fraction of the picture width (0.001 = 0.1 %). */
export function smoothness(frames, { width, height, fps, skip = () => false }) {
  if (frames.length < 12) return { ok: false, frames: frames.length };
  const px = []; const py = []; const fit = [];
  for (let i = 1; i < frames.length; i += 1) {
    const sx = slide(profile(frames[i - 1], width, height, "x"), profile(frames[i], width, height, "x"));
    const sy = slide(profile(frames[i - 1], width, height, "y"), profile(frames[i], width, height, "y"));
    px.push(sx.shift); py.push(sy.shift); fit.push(Math.min(sx.fit, sy.fit));
  }
  // split into runs of usable pairs (no scene change or fade inside, picture still matching)
  const runs = []; let run = [];
  for (let i = 0; i < px.length; i += 1) {
    const t = (i + 1) / fps;
    if (skip(t) || fit[i] < 0.5) { if (run.length) runs.push(run); run = []; } else run.push(i);
  }
  if (run.length) runs.push(run);
  const shake = []; // per usable pair: how far it strays from the smooth path, as a fraction of the width
  for (const r of runs) {
    if (r.length < 8) continue;
    const rx = residual(r.map((i) => px[i])); const ry = residual(r.map((i) => py[i]));
    r.forEach((frame, k) => shake.push({ i: frame, v: Math.hypot(rx[k], ry[k]) / width }));
  }
  if (shake.length < 12) return { ok: false, frames: frames.length, usable: shake.length };
  const sorted = shake.map((s) => s.v).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length * 0.5)];
  const high = sorted[Math.floor(sorted.length * 0.95)];
  // the stretch that shakes most: a sliding half-second of the residual
  const win = Math.max(6, Math.round(fps / 2)); let worstAt = 0; let worst = 0;
  for (let s = 0; s + win <= shake.length; s += 1) {
    const rms = Math.sqrt(mean(shake.slice(s, s + win).map((x) => x.v * x.v)));
    if (rms > worst) { worst = rms; worstAt = shake[s].i; }
  }
  const speeds = px.map((x, i) => Math.hypot(x, py[i]) / width).sort((a, b) => a - b);
  return { ok: true, frames: frames.length, usable: shake.length, typical, high, worst, worstAt: (worstAt + 1) / fps, speed: speeds[Math.floor(speeds.length / 2)] };
}
