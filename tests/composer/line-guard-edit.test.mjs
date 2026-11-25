/* The line guard inside a real edit (composer/server.mjs + lines.mjs): three engine scenes with their photo,
   one clean, one with a wobbling window frame, one closing pull-back. The wobbling scene must become a still-photo
   move, the pull-back must be played backwards, and the film must still be made. Needs ffmpeg and python3 with OpenCV. */
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
if (spawnSync("python3", ["-c", "import cv2"]).status !== 0) { console.log("SKIP line guard edit: OpenCV is not installed here"); process.exit(0); }
const dir = mkdtempSync(path.join(os.tmpdir(), "line-guard-edit-"));
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
try {
  const made = spawnSync("python3", [path.join(here, "line-guard-scenes.py"), dir], { encoding: "utf8" });
  if (made.status !== 0) throw new Error(made.stderr);
  const files = http.createServer((req, res) => {
    try { const body = readFileSync(path.join(dir, req.url.slice(1).split("?")[0])); res.writeHead(200, { "Content-Length": body.length }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = (server) => `http://127.0.0.1:${server.address().port}`;
  await listen(files);
  process.env.COMPOSER_DIR = path.join(dir, "work");
  const { createServer } = await import("../../composer/server.mjs");
  const composer = createServer(); await listen(composer);
  const api = async (method, url, body) => { const r = await fetch(`${base(composer)}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
  const file = (name) => `${base(files)}/${name}`;
  const T = 12, X = 0.5, n = 3, d = (T + (n - 1) * X) / n;
  const spec = { clips: [file("push_ok.mp4"), file("push_wobble.mp4"), file("push_ok.mp4")], width: 640, height: 360, duration: T, sceneSeconds: d, crossfade: X, music: null, qc: false,
    guard: { photos: [file("photo.jpg"), file("photo.jpg"), file("photo.jpg")], modes: ["push", "push", "push"], reverse: [false, false, true], fallbacks: ["push", "push", "pull"] } };
  const bad = await api("POST", "/jobs/guard-bad-0001", { ...spec, guard: { ...spec.guard, modes: ["push", "sideways", "push"] } });
  check("a guard with an unknown mode is refused", bad.status === 400, JSON.stringify(bad.data).slice(0, 120));
  const start = await api("POST", "/jobs/guard-film-0001", spec);
  check("the edit starts", start.status === 202, JSON.stringify(start.data).slice(0, 160));
  let done = {};
  for (let i = 0; i < 900; i += 1) { const r = await api("GET", "/jobs/guard-film-0001"); if (["done", "failed"].includes(r.data.status)) { done = r.data; break; } await new Promise((ok) => setTimeout(ok, 500)); }
  check("the film is made", done.status === "done", done.error || done.status);
  const guard = done.lineGuard || [];
  check("every scene was checked", guard.length === 3, JSON.stringify(guard).slice(0, 200));
  check("the clean scene keeps the engine's version", guard[0]?.used === "ai" && guard[0]?.stabilized === true);
  check("the wobbling scene becomes a still-photo move", guard[1]?.used === "still" && /moved, bent or wobbled/.test(guard[1]?.reason || ""), guard[1]?.reason);
  check("the closing pull-back is played backwards and holds", guard[2]?.reversed === true && guard[2]?.used === "ai");
  composer.close(); files.close();
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
