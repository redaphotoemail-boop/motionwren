/* Studio Ads composer test: subtitles burned in + a voiceover mixed over
   the music, on the real composer (composer/server.mjs) with ffmpeg.
   Two solid-colour scenes stand in for engine clips; a 220 Hz tone is the
   ElevenLabs music, an 880 Hz tone is the voiceover. */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const dir = mkdtempSync(path.join(os.tmpdir(), "ads-composer-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Scenes: red / green, 640×360 @24 fps, 4 s, each with a loud 3 kHz tone
// (far from the 220 Hz music and the 880 Hz voiceover, so each band is clean).
[["red", 1], ["lime", 2]].forEach(([colour, n]) => ff(["-f", "lavfi", "-i", `color=c=${colour}:s=640x360:r=24:d=4`, "-f", "lavfi", "-i", "sine=frequency=3000:sample_rate=48000:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, `s${n}.mp4`)]));
ff(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=14", "-c:a", "libmp3lame", "-b:a", "128k", path.join(dir, "music.mp3")]);
ff(["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=8", "-c:a", "libmp3lame", "-b:a", "128k", path.join(dir, "vo.mp3")]);
const musicBytes = readFileSync(path.join(dir, "music.mp3"));

const files = http.createServer((req, res) => {
  const name = req.url.slice(1).split("?")[0];
  try { const body = readFileSync(path.join(dir, name)); res.writeHead(200, { "Content-Length": body.length }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
const eleven = http.createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  if (/output_format=mp3_44100_192/.test(req.url)) { res.writeHead(403, { "Content-Type": "application/json" }); return res.end('{"detail":{"status":"output_format_not_allowed"}}'); }
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": musicBytes.length }); res.end(musicBytes);
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
await Promise.all([files, eleven].map(listen));

process.env.ELEVENLABS_API_KEY = "test-eleven-key";
process.env.ELEVENLABS_API_BASE = base(eleven);
process.env.COMPOSER_DIR = path.join(dir, "work");
const { createServer, editArgs, assText } = await import("../../composer/server.mjs");
const composer = createServer(); await listen(composer);
const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const waitDone = async (key) => { for (let i = 0; i < 300; i += 1) { const r = await api("GET", `/jobs/${key}`); if (["done", "failed"].includes(r.data.status)) return r.data; await new Promise((ok) => setTimeout(ok, 200)); } return { status: "timeout" }; };
const clip = (n) => `${base(files)}/s${n}.mp4`;
const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]).toString());
const frame = (file, t) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
const meanDb = (file, filter) => { const out = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `${filter},volumedetect`, "-f", "null", "-"], { encoding: "utf8" }); return Number(/mean_volume: (-?[\d.]+)/.exec(out.stderr)?.[1] ?? -999); };
// The scenes' 3 kHz tone, measured in one time window (atrim isolates it).
const tone3k = "highpass=f=2950,highpass=f=2950,lowpass=f=3050,lowpass=f=3050";
const tone3kWindow = (file, start, end) => meanDb(file, `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,${tone3k}`);
const save = async (key) => { const r = await api("GET", `/jobs/${key}/output`); const file = path.join(dir, `${key}.mp4`); writeFileSync(file, r.data); return file; };

const subtitles = { lines: [{ start: 1, end: 3.5, text: "FIRST LINE" }, { start: 5, end: 7, text: "SECOND LINE" }], position: "bottom", size: "large" };
const spec = (over = {}) => ({ clips: [clip(1), clip(2)], width: 640, height: 360, duration: 8, sceneSeconds: 4.25, crossfade: 0.5, music: { prompt: "Bold modern groove for a brand commercial" }, subtitles, voiceover: { url: `${base(files)}/vo.mp3` }, ...over });

/* A. The edit arguments carry subtitles + voiceover, and the .ass is well formed. */
{
  const args = editArgs({ clips: ["a.mp4", "b.mp4"], music: "m.mp3", voiceover: "v.mp3", subtitles: "s.ass", width: 640, height: 360, fps: 24, crossfade: 0.5, duration: 8, sceneSeconds: 4.25, output: "o.mp4" });
  const joined = args.join(" ");
  check("A1 the filter burns subtitles in and maps the subtitled picture", joined.includes("subtitles=") && joined.includes("[vsub]") && joined.includes("-map [vsub]"), joined.slice(joined.indexOf("subtitles="), joined.indexOf("subtitles=") + 60));
  check("A2 music and voiceover mix to one track, music ducked", joined.includes("amix=inputs=2") && joined.includes("volume=0.35"), "");
  const ass = assText(subtitles.lines, { position: "bottom", size: "large", height: 360 });
  check("A3 the .ass has both lines, bottom alignment, scaled size", ass.includes("FIRST LINE") && ass.includes("0:00:01.00,0:00:03.50") && /,2,20,20,40,1/.test(ass) && ass.includes("Liberation Sans,21,"), "");
}

/* B. The full edit: subtitles + voiceover + music. */
{
  const start = await api("POST", "/jobs/ads-sub-vo-01", spec());
  check("B1 an ad edit starts", start.status === 202, JSON.stringify(start.data).slice(0, 120));
  const done = await waitDone("ads-sub-vo-01");
  check("B2 the film finishes", done.status === "done", done.error || "");
  const file = await save("ads-sub-vo-01");
  const info = probe(file);
  const audio = info.streams.filter((s) => s.codec_type === "audio");
  check("B3 exact length, asked size, one sound track", Math.abs(Number(info.format.duration) - 8) < 0.15 && info.streams.find((s) => s.codec_type === "video").width === 640 && audio.length === 1, `${info.format.duration} ${JSON.stringify(info.streams.map((s) => s.codec_type))}`);
  check("B4 the voiceover is in the mix (880 Hz band)", meanDb(file, "highpass=f=750,lowpass=f=950") > -45, `${meanDb(file, "highpass=f=750,lowpass=f=950")} dB`);
  check("B5 the music is under it (220 Hz band)", meanDb(file, "lowpass=f=400") > -30, `${meanDb(file, "lowpass=f=400")} dB`);
  // Doubled filters: a single 2nd-order highpass only takes ~21 dB off the
  // loud 880 Hz voiceover, which would read as "3 kHz present" by itself.
  check("B6 the scenes' own 3 kHz tone is gone", meanDb(file, "highpass=f=2950,highpass=f=2950,lowpass=f=3050,lowpass=f=3050") < -50, `${meanDb(file, "highpass=f=2950,highpass=f=2950,lowpass=f=3050,lowpass=f=3050")} dB`);
}

/* C. The same film without subtitles: the subtitled frame must differ. */
{
  await api("POST", "/jobs/ads-sub-vo-02", spec({ subtitles: undefined, voiceover: undefined }));
  const done = await waitDone("ads-sub-vo-02");
  check("C1 the plain film finishes", done.status === "done", done.error || "");
  const plain = await save("ads-sub-vo-02");
  const withSubs = path.join(dir, "ads-sub-vo-01.mp4");
  const a = frame(withSubs, 2), b = frame(plain, 2);
  check("C2 subtitles change the picture at a subtitle time", !a.equals(b), `${a.length} vs ${b.length} bytes`);
  const c = frame(withSubs, 4.2), d = frame(plain, 4.2);
  check("C3 away from any subtitle the pictures match", c.equals(d), "");
}

/* D. Bad specs are refused, not rendered. */
{
  const badTime = await api("POST", "/jobs/ads-bad-sub-01", spec({ subtitles: { lines: [{ start: 1, end: 99, text: "too long" }] } }));
  check("D1 a subtitle past the film is refused", badTime.status === 400, `${badTime.status} ${JSON.stringify(badTime.data).slice(0, 120)}`);
  const badVo = await api("POST", "/jobs/ads-bad-vo-01", spec({ voiceover: { url: "not-a-link" } }));
  check("D2 a voiceover without a link is refused", badVo.status === 400, `${badVo.status} ${JSON.stringify(badVo.data).slice(0, 120)}`);
}

/* E. Toggle-off Studio Ads: keepAudio across both scenes, no ElevenLabs sound. */
{
  // (d) Arg level: the multi-clip keepAudio path joins scene audio and maps one track.
  const keepArgs = editArgs({ clips: ["a.mp4", "b.mp4"], keepAudio: true, width: 640, height: 360, fps: 24, crossfade: 0.5, duration: 8, sceneSeconds: 4.25, output: "o.mp4" });
  const keepJoined = keepArgs.join(" ");
  check("E1 keepAudio multi-clip joins scene audio with acrossfade and maps one track", keepJoined.includes("acrossfade=d=0.500") && keepJoined.includes("-map [aout]") && !keepArgs.includes("-an"), keepJoined.slice(keepJoined.indexOf("acrossfade"), keepJoined.indexOf("acrossfade") + 40));
  const oneSilentArgs = editArgs({ clips: ["a.mp4", "b.mp4"], keepAudio: true, hasAudio: [true, false], width: 640, height: 360, fps: 24, crossfade: 0.5, duration: 8, sceneSeconds: 4.25, output: "o.mp4" });
  check("E2 a scene with no audio is silence-filled, not dropped", oneSilentArgs.join(" ").includes("anullsrc") && oneSilentArgs.join(" ").includes("acrossfade=d=0.500"), "");
  const noAudioArgs = editArgs({ clips: ["a.mp4", "b.mp4"], keepAudio: true, hasAudio: [false, false], width: 640, height: 360, fps: 24, crossfade: 0.5, duration: 8, sceneSeconds: 4.25, output: "o.mp4" });
  check("E3 no scene audio at all stays silent (-an)", noAudioArgs.includes("-an") && !noAudioArgs.join(" ").includes("acrossfade"), "");

  // (a) End to end: both scenes keep their 3 kHz tone, early and late.
  const start = await api("POST", "/jobs/ads-keep-audio-01", spec({ music: undefined, voiceover: undefined, subtitles: undefined, keepAudio: true }));
  check("E4 a keepAudio ad edit starts", start.status === 202, JSON.stringify(start.data).slice(0, 120));
  const done = await waitDone("ads-keep-audio-01");
  check("E5 the keepAudio film finishes", done.status === "done", done.error || "");
  const file = await save("ads-keep-audio-01");
  const info = probe(file);
  const audio = info.streams.filter((s) => s.codec_type === "audio");
  check("E6 exact length, asked size, one sound track", Math.abs(Number(info.format.duration) - 8) < 0.15 && info.streams.find((s) => s.codec_type === "video").width === 640 && audio.length === 1, `${info.format.duration} ${JSON.stringify(info.streams.map((s) => s.codec_type))}`);
  const earlyDb = tone3kWindow(file, 1, 3), lateDb = tone3kWindow(file, 4.5, 5.5);
  check("E7 the first scene's tone is audible early (1–3 s)", earlyDb > -45, `${earlyDb} dB`);
  check("E8 the second scene's tone is audible late (4.5–5.5 s)", lateDb > -45, `${lateDb} dB`);

  // (b) One scene with no audio stream at all: the film still finishes, the
  // silent slot is quiet, and the other scene's tone is audible.
  ff(["-f", "lavfi", "-i", "color=c=blue:s=640x360:r=24:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "s3.mp4")]);
  const silentInfo = probe(path.join(dir, "s3.mp4"));
  check("E9 the silent fixture really has no audio stream", silentInfo.streams.filter((s) => s.codec_type === "audio").length === 0, JSON.stringify(silentInfo.streams.map((s) => s.codec_type)));
  const start2 = await api("POST", "/jobs/ads-keep-audio-02", spec({ clips: [`${base(files)}/s3.mp4`, clip(2)], music: undefined, voiceover: undefined, subtitles: undefined, keepAudio: true }));
  check("E10 a keepAudio film with a silent scene starts", start2.status === 202, JSON.stringify(start2.data).slice(0, 120));
  const done2 = await waitDone("ads-keep-audio-02");
  check("E11 the silent-scene film finishes", done2.status === "done", done2.error || "");
  const file2 = await save("ads-keep-audio-02");
  const info2 = probe(file2);
  check("E12 the silent-scene film has one sound track", info2.streams.filter((s) => s.codec_type === "audio").length === 1 && Math.abs(Number(info2.format.duration) - 8) < 0.15, `${info2.format.duration} ${JSON.stringify(info2.streams.map((s) => s.codec_type))}`);
  const silentEarlyDb = tone3kWindow(file2, 1, 3), soundingLateDb = tone3kWindow(file2, 4.5, 5.5);
  check("E13 the sounding scene's tone is audible late (4.5–5.5 s)", soundingLateDb > -45, `${soundingLateDb} dB`);
  check("E14 the silent scene's slot is quiet early (1–3 s)", silentEarlyDb < -50, `${silentEarlyDb} dB`);
}

for (const server of [composer, files, eleven]) server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
