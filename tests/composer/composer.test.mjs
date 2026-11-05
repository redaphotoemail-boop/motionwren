/* The composer (composer/server.mjs) run for real with ffmpeg on small
   generated clips. Each scene carries its own loud tone (standing in for the
   engine's per-scene music); the finished film must carry only the one music
   track, cross-dissolve between scenes and land on the exact length.
   ElevenLabs and Replicate are stand-ins on localhost. */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "composer-test-"));
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Scenes: solid colours, 1280×720 @24 fps, each with a loud 1 kHz tone (the "per-scene music").
const colours = ["red", "lime", "blue"];
colours.forEach((colour, i) => ff(["-f", "lavfi", "-i", `color=c=${colour}:s=1280x720:r=24:d=4`, "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, `s${i + 1}.mp4`)]));
ff(["-f", "lavfi", "-i", "color=c=white:s=1280x720:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "short.mp4")]);
// The music: a low 220 Hz tone, 14 s.
ff(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=14", "-c:a", "libmp3lame", "-b:a", "128k", path.join(dir, "music.mp3")]);
const musicBytes = readFileSync(path.join(dir, "music.mp3"));

// Stand-ins: file host, ElevenLabs, Replicate.
const calls = { eleven: 0, replicate: 0, elevenBodies: [] };
const mode = { eleven: "ok", replicate: "ok" };
const files = http.createServer((req, res) => {
  const name = req.url.slice(1).split("?")[0];
  if (name === "missing.mp4") { res.writeHead(404); return res.end(); }
  try { const body = readFileSync(path.join(dir, name)); res.writeHead(200, { "Content-Length": body.length }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
const eleven = http.createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  calls.eleven += 1; calls.elevenBodies.push({ key: req.headers["xi-api-key"], url: req.url, body: JSON.parse(body || "{}") });
  if (mode.eleven === "down") { res.writeHead(500); return res.end("busy"); }
  if (mode.eleven === "refused") { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"detail":"invalid api key"}'); }
  // Like a Starter-plan account: 192 kbps output is refused.
  if (/output_format=mp3_44100_192/.test(req.url)) { res.writeHead(403, { "Content-Type": "application/json" }); return res.end('{"detail":{"status":"output_format_not_allowed"}}'); }
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": musicBytes.length }); res.end(musicBytes);
});
const replicate = http.createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (req.method === "POST") { calls.replicate += 1; if (mode.replicate === "down") return json(500, { detail: "down" }); return json(201, { id: "sa1", status: "starting" }); }
  return json(200, { id: "sa1", status: "succeeded", output: `${base(files)}/music.mp3` });
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
await Promise.all([files, eleven, replicate].map(listen));

process.env.ELEVENLABS_API_KEY = "test-eleven-key";
process.env.ELEVENLABS_API_BASE = base(eleven);
process.env.REPLICATE_API_TOKEN = "test-replicate-token";
process.env.REPLICATE_API_BASE = base(replicate);
process.env.COMPOSER_DIR = path.join(dir, "work");
const { createServer, editArgs } = await import("../../composer/server.mjs");
const composer = createServer(); await listen(composer);
const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const waitDone = async (key) => { for (let i = 0; i < 300; i += 1) { const r = await api("GET", `/jobs/${key}`); if (["done", "failed"].includes(r.data.status)) return r.data; await new Promise((ok) => setTimeout(ok, 200)); } return { status: "timeout" }; };
const clip = (n) => `${base(files)}/s${n}.mp4`;
const T = 10, X = 0.5, n = 3, d = (T + (n - 1) * X) / n;
const spec = (over = {}) => ({ clips: [clip(1), clip(2), clip(3)], width: 640, height: 360, duration: T, sceneSeconds: d, crossfade: X, music: { prompt: "Elegant warm piano for a home tour" }, ...over });
const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]).toString());
const save = async (key) => { const r = await api("GET", `/jobs/${key}/output`); const file = path.join(dir, `${key}.mp4`); writeFileSync(file, r.data); return { status: r.status, file }; };
const pixel = (file, t) => [...execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "crop=2:2:319:179,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])];
const meanDb = (file, filter) => { const out = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `${filter},volumedetect`, "-f", "null", "-"], { encoding: "utf8" }); return Number(/mean_volume: (-?[\d.]+)/.exec(out.stderr)?.[1] ?? -999); };

/* 1. three scenes, music from ElevenLabs */
{
  const start = await api("POST", "/jobs/film-one-0001", spec());
  check("1a a job starts", start.status === 202 && start.data.status === "running", JSON.stringify(start.data).slice(0, 120));
  const again = await api("POST", "/jobs/film-one-0001", spec());
  check("1b the same job sent twice is one job", again.status === 200);
  const done = await waitDone("film-one-0001");
  check("1c the film is made", done.status === "done", done.error || "");
  check("1d2 music asked as 128 kbps MP3, a format every ElevenLabs plan allows", /output_format=mp3_44100_128/.test(calls.elevenBodies[0]?.url || ""), calls.elevenBodies[0]?.url);
  check("1d music came from ElevenLabs, asked once, instrumental, film length + 1.5 s", done.musicSource === "elevenlabs" && calls.eleven === 1 && calls.elevenBodies[0].key === "test-eleven-key" && calls.elevenBodies[0].body.force_instrumental === true && calls.elevenBodies[0].body.music_length_ms === 11500, `${done.musicSource} calls=${calls.eleven} ${JSON.stringify(calls.elevenBodies[0]?.body)}`);
  const { file } = await save("film-one-0001");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video"); const audio = info.streams.filter((s) => s.codec_type === "audio");
  check("1e exact length", Math.abs(Number(info.format.duration) - T) < 0.1, info.format.duration);
  check("1f picture is the asked size", video.width === 640 && video.height === 360, `${video.width}x${video.height}`);
  check("1g exactly one sound track", audio.length === 1, String(audio.length));
  const sceneTone = meanDb(file, "highpass=f=700,highpass=f=700");
  const musicTone = meanDb(file, "lowpass=f=400");
  check("1h the scenes' own sound is gone; the music is there", sceneTone < -50 && musicTone > -30, `scene tone ${sceneTone} dB, music ${musicTone} dB`);
  const boundary = (d - X) + X / 2; // middle of the first dissolve
  const mid = pixel(file, boundary), inA = pixel(file, 1.5), inB = pixel(file, d + 1);
  check("1i scene 1 is red, scene 2 is green", inA[0] > 200 && inA[1] < 60 && inB[1] > 200 && inB[0] < 60, `${inA} ${inB}`);
  check("1j a true crossfade: the middle of the join is a blend of both scenes", mid[0] > 70 && mid[0] < 190 && mid[1] > 70 && mid[1] < 190, String(mid));
  const music = await api("GET", "/jobs/film-one-0001/music");
  check("1k the film's music can be fetched to reuse", music.status === 200 && music.data.length === musicBytes.length);
}

/* 2. ElevenLabs down → the backup makes the music */
{
  mode.eleven = "down"; calls.eleven = 0; calls.replicate = 0;
  await api("POST", "/jobs/film-two-0002", spec());
  const done = await waitDone("film-two-0002");
  check("2a ElevenLabs down: Stable Audio makes the music and the film finishes", done.status === "done" && done.musicSource === "stable-audio" && calls.eleven === 2 && calls.replicate === 1, `${done.status} ${done.musicSource} eleven=${calls.eleven} replicate=${calls.replicate} ${done.error || ""}`);
}

/* 3. ElevenLabs refuses (bad key) → no pointless retry, backup used */
{
  mode.eleven = "refused"; calls.eleven = 0; calls.replicate = 0;
  await api("POST", "/jobs/film-three-03", spec());
  const done = await waitDone("film-three-03");
  check("3a a refused key is not retried; the backup finishes the film", done.status === "done" && done.musicSource === "stable-audio" && calls.eleven === 1, `${done.musicSource} eleven=${calls.eleven}`);
  check("3b why ElevenLabs was skipped is kept for the manager", /HTTP 401/.test(done.musicError || ""), done.musicError);
}

/* 3c. the manager's music check: ElevenLabs only, never the backup */
{
  mode.eleven = "refused"; calls.eleven = 0; calls.replicate = 0;
  const refused = await api("POST", "/music-check");
  check("3c music check reports ElevenLabs' refusal and does not use the backup", refused.status === 200 && refused.data.ok === false && /HTTP 401/.test(refused.data.error) && calls.replicate === 0, JSON.stringify(refused.data));
  mode.eleven = "ok"; calls.eleven = 0;
  const ok = await api("POST", "/music-check");
  check("3d music check succeeds with a short track", ok.data.ok === true && calls.eleven === 1 && calls.elevenBodies.at(-1).body.music_length_ms === 5000, JSON.stringify(ok.data));
}

/* 3e. customer music samples: real ElevenLabs music, cut and faded, never the backup */
{
  mode.eleven = "ok"; calls.eleven = 0; calls.replicate = 0;
  const made = await api("POST", "/music-sample", { prompt: "Warm piano for a home tour video", seconds: 8 });
  const probeFile = path.join(dir, "sample-out.mp3"); writeFileSync(probeFile, made.data);
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "json", probeFile]).toString());
  check("3e a sample is an MP3 of the asked length, made by ElevenLabs once", made.status === 200 && info.streams[0].codec_name === "mp3" && Math.abs(Number(info.format.duration) - 8) < 0.3 && calls.eleven === 1 && calls.elevenBodies.at(-1).body.music_length_ms === 10000 && calls.replicate === 0, `${made.status} ${info.format?.duration} eleven=${calls.eleven}`);
  mode.eleven = "refused";
  const refused = await api("POST", "/music-sample", { prompt: "Warm piano for a home tour video", seconds: 8 });
  check("3f a refused sample is a clear error, never the backup", refused.status === 502 && /HTTP 401/.test(refused.data.error) && calls.replicate === 0, JSON.stringify(refused.data));
  const bad = await api("POST", "/music-sample", { prompt: "x", seconds: 8 });
  check("3g a sample needs a description", bad.status === 400);
  mode.eleven = "ok";
}

/* 4. both music makers down */
{
  mode.eleven = "down"; mode.replicate = "down";
  await api("POST", "/jobs/film-four-silent", spec());
  const silent = await waitDone("film-four-silent");
  check("4a music not required: the film still finishes, silent", silent.status === "done" && silent.musicSource === "none" && silent.music === false, `${silent.status} ${silent.musicSource}`);
  const { file } = await save("film-four-silent");
  check("4b and has no sound track at all (never the scenes' sound)", probe(file).streams.filter((s) => s.codec_type === "audio").length === 0);
  await api("POST", "/jobs/film-four-required", spec({ music: { prompt: "x", required: true } }));
  const required = await waitDone("film-four-required");
  check("4c music required: the job reports a clear failure", required.status === "failed" && /Music could not be made/.test(required.error), required.error);
  const retry = await api("POST", "/jobs/film-four-required", spec({ music: { prompt: "x", required: true } }));
  check("4d a failed job can be sent again", retry.status === 202);
  await waitDone("film-four-required");
  mode.eleven = "ok"; mode.replicate = "ok";
}

/* 5. re-edit with the film's kept music: nothing new is made */
{
  calls.eleven = 0; calls.replicate = 0;
  await api("POST", "/jobs/film-five-kept", spec({ music: { url: `${base(files)}/music.mp3` } }));
  const done = await waitDone("film-five-kept");
  check("5a a re-edit reuses the film's music (no new music made)", done.status === "done" && done.musicSource === "kept" && calls.eleven === 0 && calls.replicate === 0, `${done.status} ${done.musicSource}`);
}

/* 6. a scene link that is gone */
{
  await api("POST", "/jobs/film-six-missing", spec({ clips: [clip(1), `${base(files)}/missing.mp4`] , sceneSeconds: (T + X) / 2 }));
  const done = await waitDone("film-six-missing");
  check("6a a missing scene fails clearly (after retries)", done.status === "failed" && /Scene 2 could not be downloaded/.test(done.error), done.error);
}

/* 7. a scene shorter than its share, 8. vertical, 9. one scene */
{
  await api("POST", "/jobs/film-seven-short", spec({ clips: [clip(1), `${base(files)}/short.mp4`, clip(3)] }));
  const short = await waitDone("film-seven-short");
  const shortFile = (await save("film-seven-short")).file;
  check("7a a short scene holds its last frame; the film is still exact", short.status === "done" && Math.abs(Number(probe(shortFile).format.duration) - T) < 0.1, `${short.status} ${short.error || ""}`);
  await api("POST", "/jobs/film-eight-vertical", spec({ width: 360, height: 640 }));
  const vertical = await waitDone("film-eight-vertical");
  const v = probe((await save("film-eight-vertical")).file).streams.find((s) => s.codec_type === "video");
  check("8a horizontal scenes fill a vertical film", vertical.status === "done" && v.width === 360 && v.height === 640, `${v?.width}x${v?.height}`);
  await api("POST", "/jobs/film-nine-single", spec({ clips: [clip(1)], duration: 3.5, sceneSeconds: 3.5 }));
  const single = await waitDone("film-nine-single");
  check("9a a one-scene video works (no crossfade)", single.status === "done" && Math.abs(single.duration - 3.5) < 0.1, `${single.status} ${single.duration}`);
}

/* 10. bad requests and the edit plan */
{
  const bad = await api("POST", "/jobs/film-ten-bad", spec({ width: 641 }));
  check("10a odd sizes are refused", bad.status === 400);
  const badKey = await api("POST", "/jobs/x", spec());
  check("10b bad job keys are refused", badKey.status === 404);
  const args = editArgs({ clips: ["a", "b", "c", "d"], music: "m", width: 1920, height: 1080, fps: 24, crossfade: 0.5, duration: 18, sceneSeconds: 4.875, output: "o.mp4" });
  const graph = args[args.indexOf("-filter_complex") + 1];
  check("10c offsets: each join starts where the previous scene's share ends minus the crossfade", graph.includes("offset=4.375") && graph.includes("offset=8.750") && graph.includes("offset=13.125"), graph.match(/offset=[\d.]+/g)?.join(","));
  check("10d only the music is mapped as sound", !/\[\d:a\]/.test(graph.replace("[4:a]", "")) && graph.includes("[4:a]"));
}

for (const server of [composer, files, eleven, replicate]) server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
