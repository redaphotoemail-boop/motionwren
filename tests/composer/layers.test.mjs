/* Voice lines and sound effects placed at set times under the music, on the
   real composer (ffmpeg). Tones stand in: 220 Hz music, 1000 Hz voice line,
   2500 Hz effect. Each must be heard only where it was placed. */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "layers-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
[["red", 1], ["lime", 2]].forEach(([colour, n]) => ff(["-f", "lavfi", "-i", `color=c=${colour}:s=640x360:r=24:d=4`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, `s${n}.mp4`)]));
const tone = (name, hz, seconds) => ff(["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=44100:duration=${seconds}`, "-c:a", "libmp3lame", "-b:a", "128k", path.join(dir, name)]);
tone("music.mp3", 220, 14); tone("voice.mp3", 1000, 2); tone("sfx.mp3", 2500, 2);

const files = http.createServer((req, res) => { try { const body = readFileSync(path.join(dir, req.url.slice(1).split("?")[0])); res.writeHead(200, { "Content-Length": body.length }); res.end(body); } catch { res.writeHead(404); res.end(); } });
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
await listen(files);
process.env.COMPOSER_DIR = path.join(dir, "work");
const { createServer, layerArgs } = await import("../../composer/server.mjs");
const composer = createServer(); await listen(composer);
const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const waitDone = async (key) => { for (let i = 0; i < 300; i += 1) { const r = await api("GET", `/jobs/${key}`); if (["done", "failed"].includes(r.data.status)) return r.data; await new Promise((ok) => setTimeout(ok, 200)); } return { status: "timeout" }; };
const band = (file, lo, hi, start, end) => { const out = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,highpass=f=${lo},highpass=f=${lo},lowpass=f=${hi},lowpass=f=${hi},volumedetect`, "-f", "null", "-"], { encoding: "utf8" }); return Number(/mean_volume: (-?[\d.]+)/.exec(out.stderr)?.[1] ?? -99); };

{
  const joined = layerArgs({ inputs: [{ file: "a.mp3", at: 1, gain: 1 }, { file: "b.mp3", at: 5, gain: 0.3 }], duration: 8, output: "o.mp3" }).join(" ");
  check("A1 each part is delayed to its time and set to its level", joined.includes("adelay=1000|1000") && joined.includes("adelay=5000|5000") && joined.includes("volume=0.300") && joined.includes("amix=inputs=2"), "");
}
{
  const spec = { clips: [`${base(files)}/s1.mp4`, `${base(files)}/s2.mp4`], width: 640, height: 360, duration: 8, sceneSeconds: 4.25, crossfade: 0.5, music: { url: `${base(files)}/music.mp3` }, layers: [{ url: `${base(files)}/voice.mp3`, at: 1, gain: 1, kind: "voice" }, { url: `${base(files)}/sfx.mp3`, at: 5, gain: 0.5, kind: "sfx" }] };
  const start = await api("POST", "/jobs/layers-01", spec);
  check("B1 a film with sound layers starts", start.status === 202, JSON.stringify(start.data).slice(0, 120));
  const done = await waitDone("layers-01");
  check("B2 it finishes", done.status === "done", done.error || "");
  const out = await api("GET", "/jobs/layers-01/output"); const file = path.join(dir, "out.mp4"); writeFileSync(file, out.data);
  check("B3 the voice line is heard where placed (1–3 s)", band(file, 950, 1050, 1.2, 2.8) > -40, `${band(file, 950, 1050, 1.2, 2.8)} dB`);
  check("B4 the voice line is not heard elsewhere (5–7 s)", band(file, 950, 1050, 5.2, 7) < -50, `${band(file, 950, 1050, 5.2, 7)} dB`);
  check("B5 the effect is heard where placed (5–7 s)", band(file, 2450, 2550, 5.2, 6.8) > -45, `${band(file, 2450, 2550, 5.2, 6.8)} dB`);
  check("B6 the effect is not heard early (1–3 s)", band(file, 2450, 2550, 1.2, 2.8) < -45, `${band(file, 2450, 2550, 1.2, 2.8)} dB`);
  check("B7 the music runs underneath all along", band(file, 150, 300, 3.5, 4.5) > -45, `${band(file, 150, 300, 3.5, 4.5)} dB`);
}
{
  const bad = await api("POST", "/jobs/layers-bad", { clips: [`${base(files)}/s1.mp4`, `${base(files)}/s2.mp4`], width: 640, height: 360, duration: 8, sceneSeconds: 4.25, crossfade: 0.5, layers: [{ url: "x", at: 1 }] });
  check("C1 a layer without a link is refused", bad.status === 400, `${bad.status}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
composer.close(); files.close();
process.exit(fail ? 1 : 0);
