/* The smoothness check (composer/smooth.mjs, composer/qc.mjs): steady camera moves pass, any shake is caught and placed in time. */
import assert from "node:assert/strict";
import { smoothness } from "../../composer/smooth.mjs";
import { shakeFlag } from "../../composer/qc.mjs";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const W = 160, H = 90, N = 96, fps = 24;
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const tex = new Float32Array(1200 * 400);
for (let y = 0; y < 400; y += 1) for (let x = 0; x < 1200; x += 1) tex[y * 1200 + x] = 128 + 60 * Math.sin(x / 9 + y / 23) + 40 * Math.sin(x / 31 - y / 7) + 20 * (rnd() - 0.5) + (Math.floor(x / 70) % 2 ? 25 : -25);
function frame(ox, oy) { const f = new Uint8Array(W * H); for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const X = x + ox + 200, Y = y + oy + 100; const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0; f[y * W + x] = Math.max(0, Math.min(255, tex[y0 * 1200 + x0] * (1 - fx) * (1 - fy) + tex[y0 * 1200 + x0 + 1] * fx * (1 - fy) + tex[(y0 + 1) * 1200 + x0] * (1 - fx) * fy + tex[(y0 + 1) * 1200 + x0 + 1] * fx * fy)); } return f; }
// a slow camera glide; `shaky(i)` gives the extra wobble (in analysis pixels) at frame i
const film = (shaky) => { const frames = []; for (let i = 0; i < N; i += 1) { const w = shaky(i); frames.push(frame(i * 0.06 + w * (rnd() - 0.5) * 2, 20 + i * 0.01 + w * (rnd() - 0.5) * 2)); } return smoothness(frames, { width: W, height: H, fps }); };

{ const r = film(() => 0); assert.ok(r.ok); assert.ok(r.typical * 100 < 0.012 && r.worst * 100 < 0.03, `steady glide read ${r.typical * 100}/${r.worst * 100}`); assert.equal(shakeFlag(r.typical * 100, r.worst * 100, r.worstAt), null); ok("a steady glide passes"); }
{ const r = film(() => 0.15); assert.equal(shakeFlag(r.typical * 100, r.worst * 100, r.worstAt)?.level, "fail"); ok("a tiny shake (a fraction of a pixel) is caught"); }
{ const r = film(() => 0.8); const f = shakeFlag(r.typical * 100, r.worst * 100, r.worstAt); assert.equal(f.level, "fail"); assert.equal(f.code, "shake"); ok("a clear shake is caught"); }
{ const r = film((i) => (i >= 60 && i < 84 ? 0.5 : 0)); const f = shakeFlag(r.typical * 100, r.worst * 100, r.worstAt); assert.equal(f.level, "fail"); assert.ok(r.worstAt >= 2.3 && r.worstAt <= 3.6, `placed at ${r.worstAt}`); ok("a shake in one stretch is placed in time"); }
{ assert.equal(shakeFlag(0.005, 0.01, 1), null); assert.equal(shakeFlag(0.013, 0.02, 1).level, "warn"); assert.equal(shakeFlag(0.03, 0.04, 1).level, "fail"); ok("thresholds"); }
console.log(`${n} passed`);
