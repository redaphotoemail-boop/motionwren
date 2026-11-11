/* MotionWren composer — the final edit of every multi-scene film.

   Runs in a Cloudflare Container (one instance per film), next to the site.
   The site sends a job; the composer:
     1. downloads the finished scene clips (our own stored copies),
     2. gets ONE music track for the whole film — the one already made for
        this film, or a new one from ElevenLabs Music (backup: Stable Audio 2.5
        on Replicate),
     3. trims every scene to its share of the film, joins them with true
        overlapping crossfades, drops the engine's per-scene sound, lays the
        one music track over the whole film with gentle fades and even
        loudness, and cuts the film to its exact length,
     4. checks the result (length, picture size, one sound track) before it
        is handed back.

   HTTP (only reachable from the site's Worker, never from the internet):
     GET    /health                 ffmpeg version
     POST   /jobs/:key              start (same key twice = same job, never two)
     GET    /jobs/:key              status
     GET    /jobs/:key/output       the finished MP4
     GET    /jobs/:key/music        the film's music (to reuse on a re-edit)
     DELETE /jobs/:key              drop the job's files
     POST   /music-check            a 5-second ElevenLabs track, no backup:
                                    confirms the key, plan and format work
     POST   /music-sample           {prompt, seconds}: a short, faded, evenly
                                    loud ElevenLabs clip (an MP3) for the
                                    customers' "hear it first" samples

   No dependencies beyond Node and ffmpeg. */

import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.env.COMPOSER_DIR || "/tmp/composer";
const ELEVEN_BASE = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";
// 128 kbps MP3 is allowed on every ElevenLabs plan; 192 kbps needs Creator or
// above and is refused on Starter. The film's sound is re-encoded anyway.
const ELEVEN_FORMAT = process.env.ELEVENLABS_MUSIC_FORMAT || "mp3_44100_128";
const REPLICATE_BASE = process.env.REPLICATE_API_BASE || "https://api.replicate.com";
const MAX_CLIP_BYTES = 400 * 1024 * 1024;
const MAX_MUSIC_BYTES = 60 * 1024 * 1024;
const MAX_VOICEOVER_BYTES = 20 * 1024 * 1024;
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** key -> { status, error, stage, startedAt, finishedAt, outputBytes, duration, width, height, musicSource, log } */
const jobs = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

async function readJson(req, limit = 256 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}

function run(command, args, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; if (stdout.length > 2e6) stdout = stdout.slice(-1e6); });
    child.stderr.on("data", (data) => { stderr += data; if (stderr.length > 2e6) stderr = stderr.slice(-1e6); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} took too long.`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code}): ${stderr.split("\n").filter(Boolean).slice(-6).join(" | ").slice(0, 900)}`));
    });
  });
}

async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", file], { timeoutMs: 60_000 });
  const data = JSON.parse(stdout);
  const video = (data.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (data.streams || []).filter((stream) => stream.codec_type === "audio");
  const [num, den] = String(video?.r_frame_rate || "0/1").split("/").map(Number);
  return {
    duration: Number(data.format?.duration) || Number(video?.duration) || 0,
    width: video?.width || 0, height: video?.height || 0,
    fps: den ? num / den : 0,
    hasVideo: Boolean(video), audioStreams: audio.length,
  };
}

/* Downloads with a few tries; a stored scene can be briefly unreachable. */
async function download(url, file, maxBytes, label) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || !response.body) throw new Error(`${label} could not be downloaded (HTTP ${response.status}).`);
      const declared = Number(response.headers.get("content-length")) || 0;
      if (declared > maxBytes) throw new Error(`${label} is too large.`);
      let size = 0;
      const counted = Readable.fromWeb(response.body).on("data", (chunk) => { size += chunk.length; if (size > maxBytes) counted.destroy(new Error(`${label} is too large.`)); });
      await pipeline(counted, createWriteStream(file));
      if (!size) throw new Error(`${label} was empty.`);
      return size;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

/* ---------- music ---------- */

async function elevenLabsMusic(prompt, seconds, file) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ElevenLabs is not connected.");
  const model = process.env.ELEVENLABS_MUSIC_MODEL || "music_v1";
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(`${ELEVEN_BASE}/v1/music?output_format=${encodeURIComponent(ELEVEN_FORMAT)}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ prompt, music_length_ms: Math.min(600_000, Math.max(3_000, Math.ceil(seconds * 1000))), model_id: model, force_instrumental: true }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!response.ok || !response.body) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        const error = new Error(`ElevenLabs music failed (HTTP ${response.status}) ${detail}`.trim());
        // A refused request (bad key, plan, prompt) will not change on a second try.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) { error.final = true; throw error; }
        throw error;
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
      const info = await probe(file);
      if (!info.audioStreams || info.duration < 1) throw new Error("ElevenLabs returned no usable audio.");
      return "elevenlabs";
    } catch (error) {
      lastError = error;
      if (error.final) break;
      if (attempt < 2) await sleep(4000);
    }
  }
  throw lastError;
}

async function stableAudioMusic(prompt, seconds, file) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("The backup music engine is not connected.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let prediction;
  for (let attempt = 1; attempt <= 6 && !prediction; attempt += 1) {
    const response = await fetch(`${REPLICATE_BASE}/v1/models/stability-ai/stable-audio-2.5/predictions`, {
      method: "POST",
      headers: { ...headers, Prefer: "wait=60" },
      body: JSON.stringify({ input: { prompt, duration: Math.min(190, Math.max(1, Math.ceil(seconds))), steps: 8, cfg_scale: 1 } }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 429) { await sleep(Math.max(2000, (Number(response.headers.get("retry-after")) || Number(/~(\d+)s/.exec(String(data.detail))?.[1]) || 10) * 1000)); continue; }
    if (!response.ok || !data.id) throw new Error(`Backup music could not start (HTTP ${response.status}) ${String(data.detail || "").slice(0, 200)}`.trim());
    prediction = data;
  }
  if (!prediction) throw new Error("Backup music engine stayed busy.");
  const deadline = Date.now() + 4 * 60 * 1000;
  while (!["succeeded", "failed", "canceled"].includes(prediction.status) && Date.now() < deadline) {
    await sleep(2500);
    const poll = await fetch(`${REPLICATE_BASE}/v1/predictions/${prediction.id}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (poll.ok) prediction = await poll.json();
  }
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (prediction.status !== "succeeded" || typeof url !== "string") throw new Error(`Backup music did not finish (${prediction.status}).`);
  await download(url, file, MAX_MUSIC_BYTES, "Backup music");
  return "stable-audio";
}

async function getMusic(spec, dir, job) {
  const file = path.join(dir, "music.mp3");
  if (!spec.music) return null;
  if (spec.music.url) {
    await download(spec.music.url, file, MAX_MUSIC_BYTES, "The film's music");
    job.musicSource = "kept";
    return file;
  }
  const seconds = spec.duration + 1.5;
  const errors = [];
  for (const maker of [elevenLabsMusic, stableAudioMusic]) {
    try {
      job.musicSource = await maker(String(spec.music.prompt || "").slice(0, 2000), seconds, file);
      // The backup made it: keep why the first choice was skipped, for the manager.
      if (errors.length) { job.musicError = errors.join(" / ").slice(0, 600); console.warn(`music: ${job.musicSource} used; ${job.musicError}`); }
      return file;
    }
    catch (error) { errors.push(error.message); }
  }
  if (spec.music.required) throw new Error(`Music could not be made: ${errors.join(" / ")}`);
  job.musicSource = "none";
  job.musicError = errors.join(" / ").slice(0, 600);
  return null;
}

import { DEPTH_MOVES, renderParallaxClip } from "./parallax.mjs";
import { cardGraph, planCards, vignetteArgs } from "./cards.mjs";
import { extractStills, qualityCheck, structureHeld } from "./qc.mjs";

/* The depth of a photo, as true distances in metres, from Depth Anything 3 Metric-Large (Apache-2.0, so it may be used commercially).
   Used by every photo move. The earlier Depth Anything v2 model was removed: its larger weights are non-commercial. */
const DEPTH3_VERSION = "e3523ab17a5e6f0e279933a6afdde67efe130bb9e7753cafc52a4b082257f46b";
async function depthMap(imageUrl, file) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("The depth service is not connected.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let prediction;
  for (let attempt = 1; attempt <= 4 && !prediction; attempt += 1) {
    const response = await fetch(`${REPLICATE_BASE}/v1/predictions`, { method: "POST", headers: { ...headers, Prefer: "wait=30" }, body: JSON.stringify({ version: DEPTH3_VERSION, input: { image: imageUrl, return_raw_depth: false, include_base64: false } }), signal: AbortSignal.timeout(60_000) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 429) { await sleep(Math.max(2000, (Number(response.headers.get("retry-after")) || 8) * 1000)); continue; }
    if (!response.ok || !data.id) throw new Error(`Depth could not start (HTTP ${response.status}) ${String(data.detail || "").slice(0, 160)}`.trim());
    prediction = data;
  }
  if (!prediction) throw new Error("The depth service stayed busy.");
  const deadline = Date.now() + 3 * 60 * 1000;
  while (!["succeeded", "failed", "canceled"].includes(prediction.status) && Date.now() < deadline) {
    await sleep(1500);
    const poll = await fetch(`${REPLICATE_BASE}/v1/predictions/${prediction.id}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (poll.ok) prediction = await poll.json();
  }
  const out = prediction.output;
  const url = typeof out === "string" ? out : out?.depth_png || out?.image;
  if (prediction.status !== "succeeded" || typeof url !== "string") throw new Error(`Depth did not finish (${prediction.status}).`);
  await download(url, file, 40 * 1024 * 1024, "The depth map");
  // Pixel value × scale + offset = metres. Without them the values are still linear distances up to scale, which is all the renderer needs.
  const scale = Number(out?.scale_m_per_unit), offset = Number(out?.offset_m);
  return Number.isFinite(scale) && scale > 0 ? { scale, offset: Number.isFinite(offset) ? offset : 0 } : { scale: 0.001, offset: 0 };
}


/* ---------- Photo move 3.0, the hybrid: a measured camera move, then AI realism on top, then a straightness guard ---------- */
const REFINE_MODEL = "wan-video/wan-2.7-videoedit";
/* An extra instruction for the refining step only. The scene prompts used for the engine clips are never touched. */
export const REFINE_PROMPT = "Keep exactly the same camera move and the same room. Make it look like a real, sharp, photorealistic real-estate video: restore natural texture and detail, and replace any stretched, smeared or hazy areas with the material around them. Every wall, door frame, window frame and roofline must stay perfectly straight and exactly where it is. Do not add, remove, move or change any object.";

async function refineClip(file, out, { width, height }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("The refining service is not connected.");
  const auth = { Authorization: `Bearer ${token}` };
  // 1. Our measured clip goes to Replicate's file store, so the model can read it.
  const form = new FormData();
  form.append("content", new Blob([await fs.readFile(file)], { type: "video/mp4" }), "move.mp4");
  const upload = await fetch(`${REPLICATE_BASE}/v1/files`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(120_000) });
  const uploaded = await upload.json().catch(() => ({}));
  const link = uploaded?.urls?.get;
  if (!upload.ok || !link) throw new Error(`The clip could not be sent for refining (HTTP ${upload.status}).`);
  // 2. The refining model, on top of that clip.
  let prediction;
  for (let attempt = 1; attempt <= 4 && !prediction; attempt += 1) {
    const response = await fetch(`${REPLICATE_BASE}/v1/models/${REFINE_MODEL}/predictions`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ input: { video: link, prompt: REFINE_PROMPT, resolution: "720p", aspect_ratio: "auto" } }), signal: AbortSignal.timeout(60_000) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 429) { await sleep(Math.max(2000, (Number(response.headers.get("retry-after")) || 10) * 1000)); continue; }
    if (!response.ok || !data.id) throw new Error(`Refining could not start (HTTP ${response.status}) ${String(data.detail || "").slice(0, 160)}`.trim());
    prediction = data;
  }
  if (!prediction) throw new Error("The refining service stayed busy.");
  const deadline = Date.now() + 12 * 60 * 1000;
  while (!["succeeded", "failed", "canceled"].includes(prediction.status) && Date.now() < deadline) {
    await sleep(3000);
    const poll = await fetch(`${REPLICATE_BASE}/v1/predictions/${prediction.id}`, { headers: auth, signal: AbortSignal.timeout(30_000) });
    if (poll.ok) prediction = await poll.json();
  }
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (prediction.status !== "succeeded" || typeof url !== "string") throw new Error(`Refining did not finish (${prediction.status}${prediction.error ? `: ${String(prediction.error).slice(0, 120)}` : ""}).`);
  const refined = `${out}.refined.mp4`;
  await download(url, refined, MAX_CLIP_BYTES, "The refined clip");
  // 3. The guard: the refined clip must keep the measured clip's lines.
  const verdict = await structureHeld(refined, file, { width, height });
  return { refined, verdict };
}

/* ---------- photo moves: a slow push, pull or slide on the original photo (no AI, so no softness) ---------- */

/* Flat moves (no depth) and the depth moves. If depth is not available, a depth move falls back to its flat look. */
export const PHOTO_MOVES = ["push", "pull", "slide-left", "slide-right", ...DEPTH_MOVES];
const FLAT_FALLBACK = { push: "push", pull: "pull", "slide-left": "slide-left", "slide-right": "slide-right", "orbit-left": "slide-left", "orbit-right": "slide-right", "push-rise": "push", "pull-rise": "pull", "push-left": "slide-left", "push-right": "slide-right" };

export function photoClipArgs({ image, move, width, height, fps, seconds, output }) {
  const frames = Math.max(2, Math.ceil(seconds * fps));
  const ease = `(0.5-0.5*cos(PI*on/${frames}))`; // gentle start and stop
  const zoom = { push: `1.04+0.14*${ease}`, pull: `1.18-0.14*${ease}`, "slide-left": "1.14", "slide-right": "1.14" }[move];
  // The gimbal's tiny slow wander (dies away at both ends), in source pixels.
  const life = `sin(PI*on/${frames})`;
  const dx = `iw*0.0045*pow(${life},0.6)*sin(2*PI*1.1*on/${frames}+0.6)`, dy = `ih*0.0035*pow(${life},0.6)*sin(2*PI*1.7*on/${frames}+1.1)`;
  const x = { push: `iw/2-iw/zoom/2+${dx}`, pull: `iw/2-iw/zoom/2+${dx}`, "slide-left": `(iw-iw/zoom)*(1-${ease})+${dx}`, "slide-right": `(iw-iw/zoom)*${ease}+${dx}` }[move];
  // Work at twice the size so the move stays smooth to the pixel, then come down to the film's size.
  const vf = `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width * 2}:${height * 2},zoompan=z='${zoom}':x='${x}':y='ih/2-ih/zoom/2+${dy}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p`;
  return ["-hide_banner", "-y", "-nostdin", "-i", image, "-vf", vf, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-pix_fmt", "yuv420p", "-an", output];
}

/* ---------- subtitles (Studio Ads) ---------- */

/* Subtitle lines → a complete .ass file for ffmpeg's subtitles filter.
   Mirrors app/ads-creative.ts buildAssText (the Worker side); the two must
   stay in the same format. The container ships Liberation Sans. */
const SUBTITLE_FONT_SIZE = { small: 36, medium: 48, large: 64 }; // at 1080p height
export function assText(lines, { position = "bottom", size = "medium", height = 1080 } = {}) {
  const fontSize = Math.max(16, Math.round(SUBTITLE_FONT_SIZE[size] * (height / 1080)));
  const alignment = position === "top" ? 8 : 2; // 2 bottom-center, 8 top-center
  const time = (seconds) => {
    const clamped = Math.max(0, seconds);
    const h = Math.floor(clamped / 3600), m = Math.floor((clamped % 3600) / 60), s = Math.floor(clamped % 60), c = Math.floor((clamped % 1) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  };
  const events = (Array.isArray(lines) ? lines : [])
    .filter((line) => line && typeof line.text === "string" && line.text.trim() && line.end > line.start)
    .map((line) => `Dialogue: 0,${time(line.start)},${time(line.end)},AdDefault,,0,0,0,,${String(line.text).replace(/\r/g, "").replace(/\n/g, "\\N").trim()}`);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: AdDefault,Liberation Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,${alignment},20,20,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/* ---------- the edit ---------- */

export function editArgs({ clips, music, width, height, fps, crossfade, duration, sceneSeconds, output, cards, keepAudio, speeds, subtitles, voiceover, hasAudio }) {
  const count = clips.length;
  const X = count > 1 ? crossfade : 0;
  const d = sceneSeconds;
  const filters = [];
  clips.forEach((_, i) => {
    // Each scene: hold its last frame if it runs short, take its share, one size and frame rate.
    // A slower scene (orbits and pans): the camera covers less of the scene, so less is made up.
    const speed = Array.isArray(speeds) && speeds[i] >= 0.5 && speeds[i] < 1 ? speeds[i] : 1;
    const slow = speed < 1 ? `setpts=PTS/${speed.toFixed(3)},minterpolate=fps=${fps}:mi_mode=blend,` : "";
    filters.push(`[${i}:v]${slow}tpad=stop_mode=clone:stop_duration=2,trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,format=yuv420p[v${i}]`);
  });
  let last = "v0";
  for (let i = 1; i < count; i += 1) {
    const offset = i * (d - X);
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${X.toFixed(3)}:offset=${offset.toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  const fadeOut = Math.min(0.8, duration / 6);
  // Sharpen: the engines' clips come out soft, so restore edge contrast on the finished film (luma only, kept subtle).
  filters.push(`[${last}]trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,cas=strength=0.55,unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.45:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=0[sharp]`);
  // The listing cards go on after sharpening; the final fade then takes everything (cards included) to black.
  let cardInputs = [];
  if (cards) {
    const base = count + (music ? 1 : 0);
    const extra = {};
    if (cards.vignette) { extra.vignette = base + cardInputs.length; cardInputs.push(["-loop", "1", "-framerate", String(fps), "-i", cards.vignette]); }
    if (cards.logo) { extra.logo = base + cardInputs.length; cardInputs.push(["-i", cards.logo]); }
    filters.push(...cardGraph(cards.plan, "sharp", "carded", extra, cards.dir));
  } else filters.push("[sharp]null[carded]");
  // Films end by fading to black; a single clip just ends.
  filters.push(count > 1 ? `[carded]fade=t=in:st=0:d=0.35,fade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[vout]` : "[carded]fade=t=in:st=0:d=0.35[vout]");
  // Subtitles burn in last, over the finished picture (cards and fades included).
  let videoOut = "vout";
  if (subtitles) {
    const safe = String(subtitles).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    filters.push(`[vout]subtitles='${safe}'[vsub]`);
    videoOut = "vsub";
  }
  const args = ["-hide_banner", "-y", "-nostdin"];
  clips.forEach((file) => args.push("-i", file));
  if (music) args.push("-i", music);
  for (const input of cardInputs) args.push(...input);
  // The voiceover goes after the cards, so its input index counts them.
  const voiceIndex = voiceover ? count + (music ? 1 : 0) + cardInputs.length : -1;
  if (voiceover) args.push("-i", voiceover);
  const tail = Math.min(2.5, duration / 4);
  const fades = `afade=t=in:st=0:d=0.8,afade=t=out:st=${(duration - tail).toFixed(3)}:d=${tail.toFixed(3)}`;
  const trim = `aresample=48000,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS`;
  // Toggle-off Studio Ads keep the scenes' own sound. Which scenes have an
  // audio stream (probed by compose()); direct callers that pass none are
  // assumed to have sound in every scene, as before. A film where no scene
  // has sound at all stays silent (-an below) — loudnorm on pure silence
  // is not a track worth making.
  const audioFlags = Array.isArray(hasAudio) && hasAudio.length === count ? hasAudio.map(Boolean) : Array(count).fill(true);
  const keepAudioMulti = Boolean(keepAudio && count > 1 && !music && !voiceover && audioFlags.some(Boolean));
  if (music && voiceover) {
    // Voiceover leads; the music ducks under it, then one mixed track.
    filters.push(`[${count}:a]${trim},${fades},volume=0.35[mus]`);
    filters.push(`[${voiceIndex}:a]${trim},${fades}[vo]`);
    filters.push("[mus][vo]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]");
  } else if (music) {
    // One track for the whole film: never the scenes' own sound.
    filters.push(`[${count}:a]${trim},${fades},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  } else if (voiceover) {
    filters.push(`[${voiceIndex}:a]${trim},${fades},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  } else if (keepAudioMulti) {
    // Each scene's sound, trimmed to its share of the film, joined with the
    // same crossfade as the picture (scene i starts at i*(d-X), which is
    // what chained acrossfades produce). A scene with no audio stream gets
    // silence in its slot, never a failure.
    audioFlags.forEach((has, i) => {
      if (has) filters.push(`[${i}:a]atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${d.toFixed(3)}[a${i}]`);
      else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    });
    let lastAudio = "a0";
    if (X > 0) {
      for (let i = 1; i < count; i += 1) {
        filters.push(`[${lastAudio}][a${i}]acrossfade=d=${X.toFixed(3)}[xa${i}]`);
        lastAudio = `xa${i}`;
      }
    } else {
      filters.push(`${audioFlags.map((_, i) => `[a${i}]`).join("")}concat=n=${count}:v=0:a=1[xa${count - 1}]`);
      lastAudio = `xa${count - 1}`;
    }
    filters.push(`[${lastAudio}]${trim},${fades},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  }
  args.push("-filter_complex", filters.join(";"), "-map", `[${videoOut}]`);
  if (music || voiceover || keepAudioMulti) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000");
  else if (keepAudio && count === 1) args.push("-map", "0:a?", "-af", `afade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`, "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "17", "-tune", "film", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(fps), "-g", String(fps * 2), "-movflags", "+faststart", "-t", duration.toFixed(3), output);
  return args;
}

function validSpec(spec) {
  const clips = Array.isArray(spec.clips) ? spec.clips : [];
  if (clips.length < 1 || clips.length > 20 || clips.some((url) => typeof url !== "string" || !/^https?:\/\//.test(url))) return "Between 1 and 20 scene links are needed.";
  if (![spec.width, spec.height].every((value) => Number.isInteger(value) && value >= 240 && value <= 4096 && value % 2 === 0)) return "Width and height must be even numbers.";
  if (spec.speeds !== undefined && !(Array.isArray(spec.speeds) && spec.speeds.length === clips.length && spec.speeds.every((value) => typeof value === "number" && value >= 0.5 && value <= 1))) return "Scene speeds must match the scenes (0.5 to 1).";
  if (spec.refs !== undefined && !(Array.isArray(spec.refs) && spec.refs.length === clips.length && spec.refs.every((value) => value === null || (typeof value === "string" && /^https?:\/\//.test(value))))) return "Reference clips must match the scenes.";
  if (spec.hybrid !== undefined && typeof spec.hybrid !== "boolean") return "Hybrid must be true or false.";
  if (spec.depthMode !== undefined && spec.depthMode !== "metric") return "Unknown depth mode.";
  if (spec.strictDepth === true && Array.isArray(spec.moves) && spec.moves.some((move) => move && !DEPTH_MOVES.includes(move))) return "Photo move 2.0 uses only the depth moves.";
  if (spec.moves !== undefined && !(Array.isArray(spec.moves) && spec.moves.length === clips.length && spec.moves.every((move) => move === null || PHOTO_MOVES.includes(move)))) return "Photo moves must match the scenes.";
  if (!(spec.duration > 1 && spec.duration <= 600)) return "Film length is out of range.";
  if (!(spec.sceneSeconds > 0.5 && spec.sceneSeconds <= 60)) return "Scene length is out of range.";
  if (!(spec.crossfade >= 0 && spec.crossfade < spec.sceneSeconds / 2)) return "Crossfade is out of range.";
  if (spec.music && !spec.music.url && typeof spec.music.prompt !== "string") return "Music needs a prompt or a link.";
  if (spec.subtitles !== undefined) {
    const sub = spec.subtitles;
    if (!sub || !Array.isArray(sub.lines) || sub.lines.length < 1 || sub.lines.length > 40) return "Subtitles need 1 to 40 lines.";
    if (sub.position !== undefined && !["bottom", "top"].includes(sub.position)) return "Subtitle position must be bottom or top.";
    if (sub.size !== undefined && !["small", "medium", "large"].includes(sub.size)) return "Subtitle size must be small, medium or large.";
    for (const line of sub.lines) {
      if (typeof line.text !== "string" || !line.text.trim() || line.text.length > 200) return "Each subtitle line needs text under 200 characters.";
      if (!(line.start >= 0 && line.end > line.start && line.end <= spec.duration + 1)) return "Subtitle times must fit the film.";
    }
  }
  if (spec.voiceover !== undefined && !(spec.voiceover && typeof spec.voiceover.url === "string" && /^https?:\/\//.test(spec.voiceover.url))) return "Voiceover needs a link.";
  return "";
}

async function compose(key, spec) {
  const job = jobs.get(key);
  const dir = path.join(ROOT, key);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    job.stage = "downloading";
    const files = [];
    const queue = [...spec.clips.keys()];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const i = queue.shift();
        const name = `scene-${String(i + 1).padStart(2, "0")}`;
        const file = path.join(dir, `${name}.mp4`);
        const move = Array.isArray(spec.moves) ? spec.moves[i] : null;
        if (move) {
          // A photo move: the link is the original photo; the camera move is made here.
          const image = path.join(dir, `${name}.img`);
          await download(spec.clips[i], image, MAX_CLIP_BYTES, `Scene ${i + 1}`);
          const shape = { width: spec.width, height: spec.height, fps: spec.photoFps || 24, seconds: spec.sceneSeconds + 2, output: file };
          if (DEPTH_MOVES.includes(move)) {
            try {
              const depthFile = path.join(dir, `${name}-depth.png`);
              const metric = await depthMap(spec.clips[i], depthFile); // every photo move uses the commercial-use (Apache-2.0) metric depth model
              await renderParallaxClip({ image, depthImage: depthFile, move, boost: spec.strictDepth ? 1.2 : 1, edgeAware: spec.strictDepth === true, metric, ...shape });
              job.depthScenes = (job.depthScenes || 0) + 1;
              if (spec.hybrid === true) {
                try {
                  const { refined, verdict } = await refineClip(file, file, { width: spec.width, height: spec.height });
                  (job.hybrid ||= []).push({ scene: i + 1, used: verdict.held ? "ai" : "measured", ...verdict });
                  if (verdict.held) await fs.rename(refined, file); else await fs.rm(refined, { force: true });
                } catch (error) {
                  // Never lose a film over the AI step: the measured clip is already good geometry.
                  (job.hybrid ||= []).push({ scene: i + 1, used: "measured", error: String(error?.message || error).slice(0, 200) });
                  console.warn(`hybrid: scene ${i + 1} kept the measured clip; ${error?.message || error}`);
                }
              }
            } catch (error) {
              // Photo move 2.0 is real 3D or nothing: no flat zoom, the film waits and says why.
              if (spec.strictDepth) throw new Error(`Photo move 2.0 needs the depth step: ${String(error?.message || error).slice(0, 200)}`);
              // Never fail the film over depth: this scene gets the flat version of the move (a guessed depth bends straight walls, so none is used).
              job.depthFallbacks = (job.depthFallbacks || 0) + 1; job.depthError = String(error?.message || error).slice(0, 300);
              console.warn(`depth: scene ${i + 1} used a flat move; ${job.depthError}`);
              await run("ffmpeg", photoClipArgs({ image, move: FLAT_FALLBACK[move], ...shape }), { timeoutMs: 5 * 60 * 1000 });
            }
          } else await run("ffmpeg", photoClipArgs({ image, move, ...shape }), { timeoutMs: 5 * 60 * 1000 });
        } else await download(spec.clips[i], file, MAX_CLIP_BYTES, `Scene ${i + 1}`);
        files[i] = file;
      }
    }));
    // Hybrid scenes: an AI clip made on top of a measured camera move must keep the move's straight lines; if not, the measured clip is used.
    if (Array.isArray(spec.refs)) {
      for (let i = 0; i < files.length; i += 1) {
        if (!spec.refs[i]) continue;
        try {
          const ref = path.join(dir, `scene-${String(i + 1).padStart(2, "0")}-ref.mp4`);
          await download(spec.refs[i], ref, MAX_CLIP_BYTES, `Scene ${i + 1} reference`);
          const verdict = await structureHeld(files[i], ref, { width: spec.width, height: spec.height });
          (job.guard ||= []).push({ scene: i + 1, ...verdict });
          if (!verdict.held) { files[i] = ref; job.guarded = (job.guarded || 0) + 1; }
        } catch (error) { console.warn(`guard: scene ${i + 1} skipped; ${error.message}`); }
      }
    }
    const infos = await Promise.all(files.map(probe));
    infos.forEach((info, i) => { if (!info.hasVideo || info.duration < 0.5) throw new Error(`Scene ${i + 1} is not a usable video.`); });
    const fps = [24, 25, 30].reduce((best, value) => Math.abs(value - infos[0].fps) < Math.abs(best - infos[0].fps) ? value : best, 30);

    job.stage = "music";
    const music = await getMusic(spec, dir, job);
    // Studio Ads: a voiceover track to mix over the music, and subtitle
    // lines to burn in. A bad voiceover fails the film (it was asked for);
    // bad subtitles never do — the film is made without them.
    let voiceover = null;
    if (spec.voiceover?.url) {
      voiceover = path.join(dir, "voiceover.mp3");
      await download(spec.voiceover.url, voiceover, MAX_VOICEOVER_BYTES, "The voiceover");
      const voiceInfo = await probe(voiceover);
      if (!voiceInfo.audioStreams || voiceInfo.duration < 0.5) throw new Error("The voiceover is not usable audio.");
    }
    let subtitles = null;
    if (spec.subtitles?.lines?.length) {
      try {
        subtitles = path.join(dir, "subtitles.ass");
        await fs.writeFile(subtitles, assText(spec.subtitles.lines, { position: spec.subtitles.position, size: spec.subtitles.size, height: spec.height }));
      } catch (error) { job.subtitlesError = String(error?.message || error).slice(0, 300); console.warn(`subtitles: skipped; ${job.subtitlesError}`); subtitles = null; }
    }

    job.stage = "editing";
    const output = path.join(dir, "film.mp4");
    const crossfade = files.length > 1 ? spec.crossfade : 0;
    // The listing cards (opening property card, closing agent card), when asked for.
    let cards = null;
    if (spec.cards) {
      try {
        const plan = planCards(spec.cards, { width: spec.width, height: spec.height, duration: spec.duration, fps, single: files.length === 1 });
        if (plan) {
          for (const file of plan.files) await fs.writeFile(path.join(dir, file.name), file.text);
          let vignette = null, logo = null;
          if (plan.opening || (plan.single && plan.closing)) { vignette = path.join(dir, "card-vignette.png"); await run("ffmpeg", vignetteArgs({ width: spec.width, height: spec.height, output: vignette }), { timeoutMs: 60_000 }); }
          if (plan.logoData) { logo = path.join(dir, "card-logo.img"); await fs.writeFile(logo, Buffer.from(plan.logoData.split(",")[1], "base64")); }
          cards = { plan, dir, vignette, logo };
          job.cards = true;
        }
      } catch (error) { job.cardsError = String(error?.message || error).slice(0, 300); console.warn(`cards: skipped; ${job.cardsError}`); cards = null; }
    }
    const editInput = { clips: files, music, voiceover, subtitles, width: spec.width, height: spec.height, fps, crossfade, duration: spec.duration, sceneSeconds: spec.sceneSeconds, output, keepAudio: spec.keepAudio === true, hasAudio: infos.map((info) => info.audioStreams > 0), speeds: spec.speeds };
    try { await run("ffmpeg", editArgs({ ...editInput, cards }), { timeoutMs: 20 * 60 * 1000 }); }
    catch (error) {
      // A card that cannot be drawn never costs the film: make it again without the cards.
      if (!cards) throw error;
      job.cardsError = String(error?.message || error).slice(0, 300); job.cards = false; console.warn(`cards: edit retried without them; ${job.cardsError}`);
      await run("ffmpeg", editArgs(editInput), { timeoutMs: 20 * 60 * 1000 });
    }

    job.stage = "checking";
    const check = await probe(output);
    if (!check.hasVideo || Math.abs(check.duration - spec.duration) > 0.25) throw new Error(`The edit came out ${round(check.duration, 2)} s instead of ${spec.duration} s.`);
    if (check.width !== spec.width || check.height !== spec.height) throw new Error(`The edit came out ${check.width}×${check.height}.`);
    if ((music || voiceover) && check.audioStreams !== 1) throw new Error("The edit is missing its sound.");
    // The free quality check: it only reports, it never fails or changes the film.
    if (spec.qc !== false) { job.stage = "quality"; job.qc = await qualityCheck(output, { width: check.width, height: check.height, duration: check.duration, sceneSeconds: spec.sceneSeconds, crossfade: files.length > 1 ? crossfade : 0, hasCards: Boolean(cards) }); }
    if (spec.stills) { try { job.stills = (await extractStills(output, dir, { duration: check.duration, count: 4 })).length; } catch (error) { job.stills = 0; console.warn(`stills: ${error.message}`); } }
    const stat = await fs.stat(output);
    Object.assign(job, { status: "done", stage: "done", finishedAt: Date.now(), outputBytes: stat.size, duration: round(check.duration, 3), width: check.width, height: check.height, fps, music: Boolean(music) });
    if (music) job.musicBytes = (await fs.stat(music)).size;
    // The downloaded scenes are no longer needed.
    await Promise.allSettled(files.map((file) => fs.rm(file, { force: true })));
  } catch (error) {
    Object.assign(job, { status: "failed", finishedAt: Date.now(), error: String(error?.message || error).slice(0, 1200) });
  }
}

/* The manager's music check: one short ElevenLabs track, no backup, so a
   refused key, plan or format shows up as ElevenLabs' own answer. */
async function musicCheck() {
  await fs.mkdir(ROOT, { recursive: true });
  const dir = await fs.mkdtemp(path.join(ROOT, "check-"));
  try {
    const file = path.join(dir, "check.mp3");
    await elevenLabsMusic("Short calm instrumental piano phrase, soft and warm. No vocals.", 5, file);
    const info = await probe(file);
    return { ok: true, source: "elevenlabs", duration: round(info.duration, 2) };
  } catch (error) {
    console.warn(`music check: ${error.message}`);
    return { ok: false, error: String(error.message || "ElevenLabs did not answer.").slice(0, 400) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* A customer-facing sample of a music template: a few seconds of ElevenLabs
   music (no backup — a sample must be the real thing), cut to length with a
   gentle fade-out and the same loudness as a finished film. */
async function musicSample(prompt, seconds) {
  await fs.mkdir(ROOT, { recursive: true });
  const dir = await fs.mkdtemp(path.join(ROOT, "sample-"));
  const raw = path.join(dir, "raw.mp3");
  const out = path.join(dir, "sample.mp3");
  try {
    await elevenLabsMusic(prompt, seconds + 2, raw);
    const fade = Math.min(1.5, seconds / 3);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-t", String(seconds),
      "-af", `afade=t=in:d=0.3,afade=t=out:st=${round(seconds - fade, 2)}:d=${round(fade, 2)},loudnorm=I=-16:TP=-1.5:LRA=11`,
      "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", out], { timeoutMs: 120_000 });
    const info = await probe(out);
    if (!info.audioStreams || info.duration < seconds - 1) throw new Error("The sample came out too short.");
    return { dir, out, bytes: (await fs.stat(out)).size };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function publicJob(key) {
  const job = jobs.get(key);
  if (!job) return { key, status: "unknown" };
  const rest = { ...job };
  delete rest.spec; // the request itself stays private to the job
  return { key, ...rest };
}

async function streamFile(res, file, type) {
  try {
    const stat = await fs.stat(file);
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size });
    await pipeline(createReadStream(file), res);
  } catch {
    if (!res.headersSent) send(res, 404, { error: "Not found." });
    else res.destroy();
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://composer");
      if (url.pathname === "/health" || url.pathname === "/ping") {
        const { stdout } = await run("ffmpeg", ["-hide_banner", "-version"], { timeoutMs: 10_000 }).catch(() => ({ stdout: "" }));
        return send(res, 200, { ok: true, ffmpeg: stdout.split("\n")[0] || "missing", jobs: jobs.size });
      }
      if (url.pathname === "/music-check" && req.method === "POST") return send(res, 200, await musicCheck());
      if (url.pathname === "/music-sample" && req.method === "POST") {
        const body = await readJson(req);
        const prompt = String(body.prompt || "").slice(0, 2000);
        const seconds = Math.min(30, Math.max(5, Number(body.seconds) || 14));
        if (prompt.length < 10) return send(res, 400, { error: "A music description is required." });
        let made;
        try { made = await musicSample(prompt, seconds); }
        catch (error) { console.warn(`music sample: ${error.message}`); return send(res, 502, { error: String(error.message || "The sample could not be made.").slice(0, 400) }); }
        try { return await streamFile(res, made.out, "audio/mpeg"); }
        finally { await fs.rm(made.dir, { recursive: true, force: true }).catch(() => undefined); }
      }
      const match = /^\/jobs\/([^/]+)(\/output|\/music|\/still\/[1-9])?$/.exec(url.pathname);
      if (!match || !KEY.test(match[1])) return send(res, 404, { error: "Not found." });
      const key = match[1];
      if (req.method === "POST" && !match[2]) {
        const spec = await readJson(req);
        const problem = validSpec(spec);
        if (problem) return send(res, 400, { error: problem });
        const existing = jobs.get(key);
        if (existing && existing.status !== "failed") return send(res, 200, publicJob(key)); // already running or done: never twice
        jobs.set(key, { status: "running", stage: "queued", startedAt: Date.now(), spec });
        void compose(key, spec);
        return send(res, 202, publicJob(key));
      }
      if (req.method === "GET" && !match[2]) return send(res, jobs.has(key) ? 200 : 404, publicJob(key));
      if (req.method === "GET" && match[2] === "/output") {
        if (jobs.get(key)?.status !== "done") return send(res, 409, { error: "Not finished." });
        return streamFile(res, path.join(ROOT, key, "film.mp4"), "video/mp4");
      }
      if (req.method === "GET" && match[2]?.startsWith("/still/")) return streamFile(res, path.join(ROOT, key, `still-${match[2].slice(-1)}.jpg`), "image/jpeg");
      if (req.method === "GET" && match[2] === "/music") return streamFile(res, path.join(ROOT, key, "music.mp3"), "audio/mpeg");
      if (req.method === "DELETE" && !match[2]) {
        jobs.delete(key);
        await fs.rm(path.join(ROOT, key), { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "Method not allowed." });
    } catch (error) {
      return send(res, error.status || 500, { error: String(error?.message || error).slice(0, 500) });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await fs.mkdir(ROOT, { recursive: true });
  createServer().listen(PORT, "0.0.0.0", () => console.log(`composer listening on ${PORT}`));
}
