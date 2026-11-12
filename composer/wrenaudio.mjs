/* WrenCut sound: "hears" a reference by measuring it, never by keeping it. From
   the audio it takes the tempo, the energy and tone of the music bed, and the
   accents on the cuts (a rising whoosh into the cut, or a hit on it). Only a
   few numbers and two text prompts come out; the audio itself is not kept. */

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

export function toneWords({ meanDb, ratio }) {
  const energy = meanDb > -20 ? "driving, full of energy" : meanDb > -28 ? "moderate energy, confident" : "soft, calm and spacious";
  const tone = ratio < 0.35 ? "warm and deep" : ratio < 0.7 ? "balanced" : "bright and crisp";
  return { energy, tone };
}

const SFX_PROMPTS = {
  whoosh: (tone) => `Short cinematic whoosh transition sound effect, ${tone === "bright and crisp" ? "airy, crisp swish" : tone === "warm and deep" ? "deep, smooth sweep" : "smooth swish"}, about one second, no music, no voices`,
  hit: (tone) => `Short soft cinematic impact hit, ${tone === "warm and deep" ? "deep sub thump" : "tight clean thud"}, very brief, no music, no voices`,
  flash: (tone) => `Bright camera-flash transition: a quick shimmering whoosh with a soft hit, ${tone === "warm and deep" ? "warm" : "crisp"}, about one second, no music, no voices`,
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
  // Accents on the cuts: a build-up before a join is a whoosh, a sudden peak on it is a hit.
  const sfx = [];
  joins.forEach((join, index) => {
    const before = mean(window(join.at - 0.4, join.at - 0.08)), earlier = mean(window(join.at - 1.0, join.at - 0.55));
    const peak = Math.max(...window(join.at - 0.05, join.at + 0.25)), around = median(window(join.at - 1.5, join.at + 1.5));
    const built = before > earlier * 1.8 && before > around * 1.2;
    const struck = peak > around * 2.2;
    if (join.type === "flash" && (built || struck)) sfx.push({ join: index, kind: "flash", lead: 0.2 });
    else if (built) sfx.push({ join: index, kind: "whoosh", lead: 0.3 });
    else if (struck) sfx.push({ join: index, kind: "hit", lead: 0 });
  });
  const bpm = tempo(rms);
  // A music bed: steady loudness between the accents, with a beat or at least sustained energy.
  const seconds = Math.floor(rms.length * FRAME);
  const steady = Array.from({ length: seconds }, (_, s) => median(window(s, s + 1))).filter((value) => db(value) > -45).length / Math.max(1, seconds);
  const music = bpm || steady > 0.7
    ? { ...(bpm ? { bpm } : {}), prompt: `Instrumental background music${bpm ? `, around ${bpm} BPM` : ""}, ${words.energy}, ${words.tone} tone, steady rhythm, no vocals, polished and modern, made for a short social video` }
    : undefined;
  return { ...(music ? { music } : {}), sfx: sfx.map((item) => ({ ...item, prompt: sfxPrompt(item.kind, words.tone) })), tone: words.tone, duration: Math.round(duration * 10) / 10 };
}
