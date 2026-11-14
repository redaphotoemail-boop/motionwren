/* WrenCut through the real composer job path: a template film with speed ramps and a flash join is made shot by shot,
   joined, and comes out at the recipe's length — and matches a single-pass render of the same recipe (quality unchanged). */
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "wrencut-job-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const dur = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
[1, 2, 3].forEach((n) => ff(["-f", "lavfi", "-i", `testsrc2=s=540x960:r=24:d=5`, "-vf", `hue=h=${n * 70}`, "-pix_fmt", "yuv420p", path.join(dir, `s${n}.mp4`)]));
const files = http.createServer((req, res) => { try { const body = readFileSync(path.join(dir, req.url.slice(1).split("?")[0])); res.writeHead(200, { "Content-Length": body.length }); res.end(body); } catch { res.writeHead(404); res.end(); } });
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await listen(files);
process.env.COMPOSER_DIR = path.join(dir, "work");
const { createServer, editArgs } = await import("../../composer/server.mjs");
const { assignClips, recipeDuration } = await import("../../composer/wrencut.mjs");
const composer = createServer(); await listen(composer);
const base = (server) => `http://127.0.0.1:${server.address().port}`;
const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const type = r.headers.get("content-type") || ""; return { status: r.status, data: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const waitDone = async (key) => { for (let i = 0; i < 600; i += 1) { const r = await api("GET", `/jobs/${key}`); if (["done", "failed"].includes(r.data.status)) return r.data; await new Promise((ok) => setTimeout(ok, 250)); } return { status: "timeout" }; };

const recipe = {
  version: 1, duration: 0, fps: 24, aspect: "vertical",
  slots: [
    { dur: 2.4, zoom: [1, 1.15], pan: [0.02, 0], speed: [[0, 0.5], [0.5, 1], [1, 2.4]] },
    { dur: 1.8, zoom: [1.1, 1], pan: [0, 0.02] },
    { dur: 2.2, zoom: [1, 1.08], pan: [0, 0], speed: [[0, 1.8], [1, 0.6]] },
    { dur: 1.6, zoom: [1, 1], pan: [0, 0] },
  ],
  joins: [{ type: "flash", dur: 0.16 }, { type: "cut", dur: 0.04 }, { type: "cut", dur: 0.04 }],
  grade: { warmth: 0.04, saturation: 1.1 },
};
recipe.duration = recipeDuration(recipe);
const spec = { clips: [1, 2, 3].map((n) => `${base(files)}/s${n}.mp4`), width: 360, height: 640, duration: recipe.duration, sceneSeconds: 2.5, crossfade: 0, music: null, recipe, recipeStrength: 0.6 };
const started = await api("POST", "/jobs/wren-job-01", spec);
check("the composer accepts the template film", started.status < 300, JSON.stringify(started.data).slice(0, 200));
const state = await waitDone("wren-job-01");
check("the film is made (ramps, flash and all)", state.status === "done", JSON.stringify(state).slice(0, 300));
const out = path.join(dir, "job-out.mp4"); writeFileSync(out, (await api("GET", "/jobs/wren-job-01/output")).data);
check("it is the recipe's length", Math.abs(dur(out) - recipe.duration) < 0.3, `${dur(out).toFixed(2)} vs ${recipe.duration.toFixed(2)}`);
// Quality: the same recipe in a single pass (the old way, via editArgs) is nearly identical frame for frame.
const single = path.join(dir, "single.mp4");
const picks = assignClips(recipe, [5, 5, 5]);
ff(editArgs({ clips: picks.map((pick) => path.join(dir, `s${pick.clip + 1}.mp4`)), width: 360, height: 640, fps: 24, crossfade: 0, duration: recipe.duration, sceneSeconds: 2.5, output: single, recipe, starts: picks.map((pick) => pick.start), strength: 0.6 }));
const psnr = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-i", single, "-lavfi", "[0:v]scale=360:640[a];[1:v]scale=360:640[b];[a][b]psnr", "-f", "null", "-"], { encoding: "utf8" });
const average = Number(/average:([\d.]+|inf)/.exec(psnr.stderr || "")?.[1] === "inf" ? 99 : /average:([\d.]+)/.exec(psnr.stderr || "")?.[1]);
check("shot-by-shot matches the single-pass render (quality unchanged)", average > 34, `PSNR ${average} dB`);
check("the film finished", state.status === "done");
console.log(`\n${pass} passed, ${fail} failed`);
composer.close(); files.close();
process.exit(fail ? 1 : 0);
