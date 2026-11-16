/* A frame cut (horizontal 16:9 / vertical 9:16) applied by the composer for real with ffmpeg, on the exact
   specs the Worker's startComposerEdit sends for an Edit film (see app/api/_lib/render-jobs.ts).
   The test picture is 3:2: a green ceiling band at the top, a blue floor band at the bottom and a red post
   in the centre. A 16:9 cut must keep the floor (and lose the ceiling first, anchorY 0.75); a vertical cut
   must keep the centre post and the whole height. */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "edit-frame-test-"));
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// 3:2 clips, 1080x720, 5 s: grey; ceiling band y 0..71 green; floor band y 648..719 blue; centre post x 530..549 red.
// Each carries a loud 1 kHz tone (the scene's own sound).
for (let i = 1; i <= 3; i += 1) {
  ff(["-f", "lavfi", "-i", "color=c=gray:s=1080x720:r=24:d=5", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=5", "-shortest", "-vf", "drawbox=x=0:y=0:w=1080:h=72:color=green:t=fill,drawbox=x=0:y=648:w=1080:h=72:color=blue:t=fill,drawbox=x=530:y=72:w=20:h=576:color=red:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, `s${i}.mp4`)]);
}
// The music: a low 220 Hz tone, 14 s.
ff(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=14", "-c:a", "libmp3lame", "-b:a", "128k", path.join(dir, "music.mp3")]);
const musicBytes = readFileSync(path.join(dir, "music.mp3"));

// Stand-ins: file host, ElevenLabs.
const files = http.createServer((req, res) => {
  const name = req.url.slice(1).split("?")[0];
  try { const body = readFileSync(path.join(dir, name)); res.writeHead(200, { "Content-Length": body.length }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
const eleven = http.createServer(async (req, res) => {
  req.resume(); // drain the request body; the track is the same whatever was asked for
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": musicBytes.length }); res.end(musicBytes);
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
await Promise.all([files, eleven].map(listen));

process.env.ELEVENLABS_API_KEY = "test-eleven-key";
process.env.ELEVENLABS_API_BASE = base(eleven);
process.env.COMPOSER_DIR = path.join(dir, "work");
const { createServer } = await import("../../composer/server.mjs");
const composer = createServer(); await listen(composer);
const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const waitDone = async (key) => { for (let i = 0; i < 300; i += 1) { const r = await api("GET", `/jobs/${key}`); if (["done", "failed"].includes(r.data.status)) return r.data; await new Promise((ok) => setTimeout(ok, 200)); } return { status: "timeout" }; };
const clip = (n) => `${base(files)}/s${n}.mp4`;
const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]).toString());
const save = async (key) => { const r = await api("GET", `/jobs/${key}/output`); const file = path.join(dir, `${key}.mp4`); writeFileSync(file, r.data); return { status: r.status, file }; };
const pixel = (file, x, y) => {
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,10),format=rgb24,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [raw[0], raw[1], raw[2]];
};
const near = (rgb, name) => name === "blue" ? rgb[2] > 180 && rgb[0] < 90 : name === "green" ? rgb[1] > 100 && rgb[0] < 90 && rgb[2] < 90 : name === "red" ? rgb[0] > 180 && rgb[1] < 90 : false;
const meanDb = (file, filter) => { const out = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `${filter},volumedetect`, "-f", "null", "-"], { encoding: "utf8" }); return Number(/mean_volume: (-?[\d.]+)/.exec(out.stderr)?.[1] ?? -999); };
// The exact spec startComposerEdit sends for a frame-only edit: the cut's width/height, anchorY 0.75, the film's
// music for multi-scene (or keepAudio for a single clip, which keeps the scene's own sound).
const editSpec = (over = {}) => ({ clips: [clip(1), clip(2), clip(3)], width: 1280, height: 720, anchorY: 0.75, duration: 14, sceneSeconds: 5, crossfade: 0.5, music: { prompt: "Warm piano for a home tour" }, ...over });
const cards = { opening: { title: "12 Maple Lane", detail: "4 beds   ·   3 baths", message: "" }, closing: { name: "Jordan Lee", contact: "617-555-0100", logo: "" } };

/* 1. Multi-scene, horizontal cut: 1280x720, floor kept, music on, scenes' own sound gone. */
{
  await api("POST", "/jobs/ef-multi-h", editSpec());
  const done = await waitDone("ef-multi-h");
  check("1a the horizontal cut renders", done.status === "done", done.error || "");
  const { file } = await save("ef-multi-h");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  check("1b the film is 1280x720 (16:9), not the 3:2 original", video.width === 1280 && video.height === 720, `${video.width}x${video.height}`);
  check("1c exact length", Math.abs(Number(info.format.duration) - 14) < 0.2, info.format.duration);
  check("1d the floor is still in the picture", near(pixel(file, 100, 710), "blue"), JSON.stringify(pixel(file, 100, 710)));
  check("1e the ceiling goes first", !near(pixel(file, 100, 1), "green"), JSON.stringify(pixel(file, 100, 1)));
  check("1f the music is there and the scenes' own sound is gone", meanDb(file, "lowpass=f=400") > -30 && meanDb(file, "highpass=f=700,highpass=f=700") < -50, `music ${meanDb(file, "lowpass=f=400")} dB, scene tone ${meanDb(file, "highpass=f=700,highpass=f=700")} dB`);
}

/* 2. Multi-scene, vertical cut: 720x1280, post centred, whole height kept. */
{
  await api("POST", "/jobs/ef-multi-v", editSpec({ width: 720, height: 1280 }));
  const done = await waitDone("ef-multi-v");
  check("2a the vertical cut renders", done.status === "done", done.error || "");
  const { file } = await save("ef-multi-v");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  check("2b the film is 720x1280 (9:16), not the 3:2 original", video.width === 720 && video.height === 1280, `${video.width}x${video.height}`);
  check("2c the post is in the middle", near(pixel(file, 360, 640), "red"), JSON.stringify(pixel(file, 360, 640)));
  check("2d the whole height is kept (floor)", near(pixel(file, 20, 1270), "blue"), JSON.stringify(pixel(file, 20, 1270)));
  check("2e the whole height is kept (ceiling)", near(pixel(file, 20, 5), "green"), JSON.stringify(pixel(file, 20, 5)));
}

/* 3. Single scene, horizontal cut: 1280x720, floor kept, its own sound kept. */
{
  await api("POST", "/jobs/ef-single-h", editSpec({ clips: [clip(1)], duration: 5, sceneSeconds: 5, crossfade: 0, music: null, keepAudio: true }));
  const done = await waitDone("ef-single-h");
  check("3a the single-scene horizontal cut renders", done.status === "done", done.error || "");
  const { file } = await save("ef-single-h");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  check("3b the film is 1280x720 (16:9)", video.width === 1280 && video.height === 720, `${video.width}x${video.height}`);
  check("3c the floor is still in the picture", near(pixel(file, 100, 710), "blue"), JSON.stringify(pixel(file, 100, 710)));
  check("3d the scene's own sound is kept", meanDb(file, "highpass=f=700,highpass=f=700") > -30, `${meanDb(file, "highpass=f=700,highpass=f=700")} dB`);
}

/* 4. Single scene, vertical cut: 720x1280, post centred. */
{
  await api("POST", "/jobs/ef-single-v", editSpec({ clips: [clip(1)], width: 720, height: 1280, duration: 5, sceneSeconds: 5, crossfade: 0, music: null, keepAudio: true }));
  const done = await waitDone("ef-single-v");
  check("4a the single-scene vertical cut renders", done.status === "done", done.error || "");
  const { file } = await save("ef-single-v");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  check("4b the film is 720x1280 (9:16)", video.width === 720 && video.height === 1280, `${video.width}x${video.height}`);
  check("4c the post is in the middle", near(pixel(file, 360, 640), "red"), JSON.stringify(pixel(file, 360, 640)));
}

/* 5. Multi-scene with cards, horizontal cut: the cards burn in and the cut still holds. */
{
  await api("POST", "/jobs/ef-multi-cards", editSpec({ cards }));
  const done = await waitDone("ef-multi-cards");
  check("5a the carded horizontal cut renders and says it drew the cards", done.status === "done" && done.cards === true, `${done.status} cards=${done.cards} ${done.cardsError || done.error || ""}`);
  const { file } = await save("ef-multi-cards");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  check("5b the film is 1280x720 (16:9)", video.width === 1280 && video.height === 720, `${video.width}x${video.height}`);
}

/* 6. Multi-scene, vertical cut, music off: 720x1280 and silent. */
{
  await api("POST", "/jobs/ef-multi-v-silent", editSpec({ width: 720, height: 1280, music: null }));
  const done = await waitDone("ef-multi-v-silent");
  check("6a the silent vertical cut renders", done.status === "done", done.error || "");
  const { file } = await save("ef-multi-v-silent");
  const info = probe(file);
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.filter((s) => s.codec_type === "audio");
  check("6b the film is 720x1280 (9:16) with no sound track", video.width === 720 && video.height === 1280 && audio.length === 0, `${video.width}x${video.height} audio=${audio.length}`);
}

for (const server of [composer, files, eleven]) server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
