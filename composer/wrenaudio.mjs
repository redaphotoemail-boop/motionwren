/* WrenCut sound: "hears" a reference by measuring it, never by keeping it. From
   the audio it takes the tempo, the energy and tone of the music bed. Only a
   few numbers and one text prompt come out; the audio itself is not kept.
   Standing rule: no whoosh sound in any template, ever — so no cut accent
   is detected or emitted here (a whoosh used to be the accent). */

import { spawn } from "node:child_process";

const RATE = 16000, HOP = 160; // 10 ms frames
const FRAME = HOP / RATE;

const pcm = (file) => new Promise((resolve, reject) => {
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
  const out = [], err = [];
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("audio read timed out")); }, 3 * 60 * 1000);
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); const buffer = Buffer.concat(out); code === 0 && buffer.length > RATE * 4 ? resolve(new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4))) : reject(new Error("no audio")); });
});

const db = (value) => 20 * Math.log10(value + 1e-9);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/* Loudness per 10 ms (rms), and the same for the sharp, high part (first difference). */
export function envelopes(samples) {
  const frames = Math.floor(samples.length / HOP);
  const rms = new Float32Array(frames), high = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let a = 0, b = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i += 1) { const x = samples[i]; a += x * x; const d = x - (samples[i - 1] || 0); b += d * d; }
    rms[f] = Math.sqrt(a / HOP); high[f] = Math.sqrt(b / HOP);
  }
  return { rms, high };
}

/* Tempo from the rhythm of rises in loudness. Returns null when there is no steady beat. */
export function tempo(rms) {
  const flux = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i += 1) flux[i] = Math.max(0, Math.log(rms[i] + 1e-6) - Math.log(rms[i - 1] + 1e-6));
  const avg = mean(flux);
  for (let i = 0; i < flux.length; i += 1) flux[i] = Math.max(0, flux[i] - avg);
  let best = { lag: 0, score: 0 }, total = 0, count = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = Math.round(60 / bpm / FRAME);
    let score = 0;
    for (let i = lag; i < flux.length; i += 1) score += flux[i] * flux[i - lag];
    score /= flux.length - lag;
    total += score; count += 1;
    if (score > best.score) best = { lag, score, bpm };
  }
  const confidence = best.score / (total / count + 1e-12);
  if (!best.bpm || confidence < 1.6) return null;
  return Math.round(best.bpm);
}

/* The beat grid: tempo AND phase. The tempo says how far apart the beats are; the phase says
   where the first one falls, so a cut can land ON a beat instead of merely a beat-length away
   from one. Fitted to the track's own onsets (not a blind grid search): the period is the
   median gap between strong onsets near the coarse tempo, and the phase is where those onsets
   fall modulo the period — so a 119-vs-120 rounding error cannot drag the grid off the beats.
   Returns { bpm, phase, period, beats, confidence } or null when there is no steady beat
   worth syncing to (an ambient track has no beat — the grid would be arbitrary, so snapping
   to it would move cuts for nothing). Confidence is the share of strong onsets the grid
   explains (within 0.05s); a real beat explains nearly all of them. */
export function beatGrid(rms) {
  const coarse = tempo(rms);
  if (!coarse) return null;
  const coarsePeriod = 60 / coarse;
  const flux = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i += 1) flux[i] = Math.max(0, Math.log(rms[i] + 1e-6) - Math.log(rms[i - 1] + 1e-6));
  const avg = mean(flux);
  for (let i = 0; i < flux.length; i += 1) flux[i] = Math.max(0, flux[i] - avg);
  // Strong onsets: local peaks of the flux, well above its mean. Keep only the strongest peak
  // in each half-period window (non-maximum suppression): a decaying kick and the sine's own
  // cycles both ring after the beat, and those echoes must not count as beats.
  const sorted = [...flux].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const candidates = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) candidates.push({ t: i * FRAME, s: flux[i] });
  }
  candidates.sort((a, b) => b.s - a.s);
  const onsets = [];
  for (const c of candidates) {
    if (onsets.every((t) => Math.abs(t - c.t) > coarsePeriod * 0.5)) onsets.push(c.t);
  }
  onsets.sort((a, b) => a - b);
  if (onsets.length < 4) return null;
  // Period: the median gap between onsets that are near the coarse period (one beat apart).
  const gaps = [];
  for (let i = 1; i < onsets.length; i += 1) { const g = onsets[i] - onsets[i - 1]; if (Math.abs(g - coarsePeriod) < coarsePeriod * 0.15) gaps.push(g); }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const period = gaps[Math.floor(gaps.length / 2)];
  const bpm = 60 / period;
  if (bpm < 70 || bpm > 180) return null;
  // Phase: where the onsets fall modulo the period (circular median, so a wrap does not split them).
  const residues = onsets.map((t) => ((t % period) + period) % period).sort((a, b) => a - b);
  let phase = residues[Math.floor(residues.length / 2)];
  // The median can sit in the gap if the cluster wraps around 0 — re-centre on the densest window.
  let bestCount = 0;
  for (const r of residues) {
    const count = residues.filter((x) => { const d = Math.abs(x - r); return Math.min(d, period - d) < 0.05; }).length;
    if (count > bestCount) { bestCount = count; phase = r; }
  }
  const duration = rms.length * FRAME;
  const beats = [];
  for (let t = phase; t < duration; t += period) beats.push(+t.toFixed(3));
  if (phase > period / 2) beats.unshift(+(phase - period).toFixed(3));
  const explained = onsets.filter((t) => { const d = Math.abs(t - phase - Math.round((t - phase) / period) * period); return d < 0.05; }).length;
  const confidence = explained / onsets.length;
  if (confidence < 0.6) return null;
  return { bpm: +bpm.toFixed(1), phase: +phase.toFixed(3), period: +period.toFixed(4), beats, confidence: +confidence.toFixed(2) };
}

/* Nearest beat to a time, and how far off it is. */
export function nearestBeat(t, grid) {
  if (!grid || !grid.beats.length) return null;
  let best = grid.beats[0], bestD = Math.abs(t - best);
  for (const b of grid.beats) { const d = Math.abs(t - b); if (d < bestD) { best = b; bestD = d; } }
  return { beat: best, offBy: +bestD.toFixed(3) };
}

/* The beat grid of a whole audio file (music track or finished film). Null when no steady beat. */
export async function analyzeBeats(file) {
  let samples;
  try { samples = await pcm(file); } catch { return null; }
  const { rms } = envelopes(samples);
  if (mean(rms.map((value) => db(value))) < -55) return null; // silent
  return beatGrid(rms);
}

export function toneWords({ meanDb, ratio }) {
  const energy = meanDb > -20 ? "driving, full of energy" : meanDb > -28 ? "moderate energy, confident" : "soft, calm and spacious";
  const tone = ratio < 0.35 ? "warm and deep" : ratio < 0.7 ? "balanced" : "bright and crisp";
  return { energy, tone };
}

// Only "hit" is left: the whoosh and flash prompts are gone (standing rule:
// no whoosh sound in any template, ever). No template path produces a hit
// either — this stays as the generic prompt builder for a non-whoosh accent.
const SFX_PROMPTS = {
  hit: (tone) => `Short soft cinematic impact hit, ${tone === "warm and deep" ? "deep sub thump" : "tight clean thud"}, very brief, no music, no voices`,
};
export const sfxPrompt = (kind, tone) => (SFX_PROMPTS[kind] || SFX_PROMPTS.hit)(tone);

/* joins: [{ at, type }] seconds in the reference where shots meet. */
export async function analyzeAudio(file, { duration, joins }) {
  let samples;
  try { samples = await pcm(file); } catch { return null; } // no sound track
  const { rms, high } = envelopes(samples);
  const loud = rms.map((value) => db(value));
  const meanDb = mean(loud);
  if (meanDb < -55) return null; // silent
  const ratio = mean(high) / (mean(rms) + 1e-9);
  const words = toneWords({ meanDb, ratio });
  const at = (seconds) => Math.max(0, Math.min(rms.length - 1, Math.round(seconds / FRAME)));
  const window = (from, to) => { const values = []; for (let i = at(from); i <= at(to); i += 1) values.push(rms[i]); return values; };
  // No cut accents: standing rule — no whoosh sound in any template, ever.
  // (A build-up before a join used to become a whoosh here; that is gone.
  // The tempo and music bed below are still measured — the beat-sync work
  // reuses the tempo detector.)
  const sfx = [];
  void joins;
  const bpm = tempo(rms);
  // A music bed: steady loudness between the accents, with a beat or at least sustained energy.
  const seconds = Math.floor(rms.length * FRAME);
  const steady = Array.from({ length: seconds }, (_, s) => median(window(s, s + 1))).filter((value) => db(value) > -45).length / Math.max(1, seconds);
  const music = bpm || steady > 0.7
    ? { ...(bpm ? { bpm } : {}), prompt: `Instrumental background music${bpm ? `, around ${bpm} BPM` : ""}, ${words.energy}, ${words.tone} tone, steady rhythm, no vocals, polished and modern, made for a short social video` }
    : undefined;
  return { ...(music ? { music } : {}), sfx: sfx.map((item) => ({ ...item, prompt: sfxPrompt(item.kind, words.tone) })), tone: words.tone, duration: Math.round(duration * 10) / 10 };
}
