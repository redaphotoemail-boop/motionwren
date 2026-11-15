/* Cinematic titles on the real composer (ffmpeg): words appear at the start and the end, never in the middle,
   the film's length and look are otherwise unchanged, and a bad title never costs the film. */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "titles-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
[["0x486b8a", 1], ["0x8a6b48", 2]].forEach(([colour, n]) => ff(["-f", "lavfi", "-i", `testsrc2=s=540x960:r=24:d=6`, "-vf", `colorchannelmixer=rr=0.6:gg=0.6:bb=0.6`, "-pix_fmt", "yuv420p", path.join(dir, `s${n}.mp4`)]));
const files = http.createServer((req, res) => { try { const body = readFileSync(path.join(dir, req.url.slice(1).split("?")[0])); res.writeHead(200, { "Content-Length": body.length, "Content-Type": "video/mp4" }); res.end(body); } catch { res.writeHead(404); res.end(); } });
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = (server) => `http://127.0.0.1:${server.address().port}`;
await listen(files);
process.env.COMPOSER_DIR = path.join(dir, "work");
const { createServer } = await import("../../composer/server.mjs");
const { TITLE_FONTS, fontFile, cleanTitles, planTitles } = await import("../../composer/titles.mjs");
const composer = createServer(); await listen(composer);
const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const type = r.headers.get("content-type") || ""; return { status: r.status, data: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const waitDone = async (key) => { for (let i = 0; i < 300; i += 1) { const r = await api("GET", `/jobs/${key}`); if (["done", "failed"].includes(r.data.status)) return r.data; await new Promise((resolve) => setTimeout(resolve, 500)); } return { status: "timeout" }; };
const frame = (file, t, out) => ff(["-ss", String(t), "-i", file, "-frames:v", "1", out]);
const psnr = (a, b) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" }); const m = /average:([\d.]+|inf)/.exec(r.stderr || ""); return m ? (m[1] === "inf" ? 99 : Number(m[1])) : 0; };

check("five fonts, all present", TITLE_FONTS.length === 5 && TITLE_FONTS.every((font) => existsSync(fontFile(font.key)) && fontFile(font.key).includes("fonts")));
check("nothing typed means no titles", cleanTitles({ font: "cinzel", start: { text: " " }, end: null }) === null);
check("an unknown font falls back", cleanTitles({ font: "comic", start: { text: "Hello" } }).font === "cormorant");
check("a plan holds the words only", planTitles({ font: "bodoni", start: { text: "The Residence", sub: "21 Beacon St" } }, { width: 540, height: 960, duration: 12, fps: 24 }).files.length === 2);

const clips = [`${base(files)}/s1.mp4`, `${base(files)}/s2.mp4`];
const spec = { clips, width: 540, height: 960, duration: 11, sceneSeconds: 6, crossfade: 1, fps: 24, qc: false };
const plain = await api("POST", "/jobs/titles-plain", spec); check("plain film starts", plain.status === 202);
const withTitles = await api("POST", "/jobs/titles-with", { ...spec, titles: { font: "playfair", start: { text: "The Residence", sub: "Beacon Hill, Boston" }, end: { text: "Book a private viewing", sub: "" } } }); check("titled film starts", withTitles.status === 202);
const bad = await api("POST", "/jobs/titles-bad", { ...spec, titles: { font: "cinzel", start: { text: "x".repeat(500) } } }); check("a very long title still starts", bad.status === 202);
const a = await waitDone("titles-plain"), b = await waitDone("titles-with"), c = await waitDone("titles-bad");
check("plain film finishes", a.status === "done", a.error || "");
check("titled film finishes", b.status === "done", b.error || "");
check("the editor drew the titles", b.titles === true, JSON.stringify({ titles: b.titles, err: b.titlesError }));
check("a very long title never costs the film", c.status === "done", c.error || "");
check("same length with or without titles", Math.abs(a.duration - b.duration) < 0.1, `${a.duration} vs ${b.duration}`);
const fa = path.join(dir, "a.mp4"), fb = path.join(dir, "b.mp4");
writeFileSync(fa, (await api("GET", "/jobs/titles-plain/output")).data); writeFileSync(fb, (await api("GET", "/jobs/titles-with/output")).data);
for (const [name, t, expectChange] of [["start", 2.5, true], ["middle", 5.5, false], ["end", 9.2, true]]) {
  frame(fa, t, path.join(dir, `a-${name}.png`)); frame(fb, t, path.join(dir, `b-${name}.png`));
  const value = psnr(path.join(dir, `a-${name}.png`), path.join(dir, `b-${name}.png`));
  check(`${name}: ${expectChange ? "the titled film differs (words drawn)" : "the picture is untouched"}`, expectChange ? value < 36 : value > 40, `${value.toFixed(1)} dB`);
}
console.log(`\n${pass} passed, ${fail} failed`);
composer.close(); files.close();
process.exit(fail ? 1 : 0);
