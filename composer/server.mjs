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

/* ---------- the edit ---------- */

export function editArgs({ clips, music, width, height, fps, crossfade, duration, sceneSeconds, output }) {
  const count = clips.length;
  const X = count > 1 ? crossfade : 0;
  const d = sceneSeconds;
  const filters = [];
  clips.forEach((_, i) => {
    // Each scene: hold its last frame if it runs short, take its share, one size and frame rate.
    filters.push(`[${i}:v]tpad=stop_mode=clone:stop_duration=2,trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,format=yuv420p[v${i}]`);
  });
  let last = "v0";
  for (let i = 1; i < count; i += 1) {
    const offset = i * (d - X);
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${X.toFixed(3)}:offset=${offset.toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  const fadeOut = Math.min(0.8, duration / 6);
  filters.push(`[${last}]trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.35,fade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[vout]`);
  const args = ["-hide_banner", "-y", "-nostdin"];
  clips.forEach((file) => args.push("-i", file));
  if (music) {
    args.push("-i", music);
    const tail = Math.min(2.5, duration / 4);
    // One track for the whole film: never the scenes' own sound.
    filters.push(`[${count}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.8,afade=t=out:st=${(duration - tail).toFixed(3)}:d=${tail.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  }
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
  if (music) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(fps), "-g", String(fps * 2), "-movflags", "+faststart", "-t", duration.toFixed(3), output);
  return args;
}

function validSpec(spec) {
  const clips = Array.isArray(spec.clips) ? spec.clips : [];
  if (clips.length < 1 || clips.length > 20 || clips.some((url) => typeof url !== "string" || !/^https?:\/\//.test(url))) return "Between 1 and 20 scene links are needed.";
  if (![spec.width, spec.height].every((value) => Number.isInteger(value) && value >= 240 && value <= 4096 && value % 2 === 0)) return "Width and height must be even numbers.";
  if (!(spec.duration > 1 && spec.duration <= 600)) return "Film length is out of range.";
  if (!(spec.sceneSeconds > 0.5 && spec.sceneSeconds <= 60)) return "Scene length is out of range.";
  if (!(spec.crossfade >= 0 && spec.crossfade < spec.sceneSeconds / 2)) return "Crossfade is out of range.";
  if (spec.music && !spec.music.url && typeof spec.music.prompt !== "string") return "Music needs a prompt or a link.";
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
        const file = path.join(dir, `scene-${String(i + 1).padStart(2, "0")}.mp4`);
        await download(spec.clips[i], file, MAX_CLIP_BYTES, `Scene ${i + 1}`);
        files[i] = file;
      }
    }));
    const infos = await Promise.all(files.map(probe));
    infos.forEach((info, i) => { if (!info.hasVideo || info.duration < 0.5) throw new Error(`Scene ${i + 1} is not a usable video.`); });
    const fps = [24, 25, 30].reduce((best, value) => Math.abs(value - infos[0].fps) < Math.abs(best - infos[0].fps) ? value : best, 30);

    job.stage = "music";
    const music = await getMusic(spec, dir, job);

    job.stage = "editing";
    const output = path.join(dir, "film.mp4");
    const crossfade = files.length > 1 ? spec.crossfade : 0;
    await run("ffmpeg", editArgs({ clips: files, music, width: spec.width, height: spec.height, fps, crossfade, duration: spec.duration, sceneSeconds: spec.sceneSeconds, output }), { timeoutMs: 20 * 60 * 1000 });

    job.stage = "checking";
    const check = await probe(output);
    if (!check.hasVideo || Math.abs(check.duration - spec.duration) > 0.25) throw new Error(`The edit came out ${round(check.duration, 2)} s instead of ${spec.duration} s.`);
    if (check.width !== spec.width || check.height !== spec.height) throw new Error(`The edit came out ${check.width}×${check.height}.`);
    if (music && check.audioStreams !== 1) throw new Error("The edit is missing its music.");
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
      const match = /^\/jobs\/([^/]+)(\/output|\/music)?$/.exec(url.pathname);
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
