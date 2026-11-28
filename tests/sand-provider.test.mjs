import assert from "node:assert/strict";
import { sandCreate, sandPrediction, isSandId } from "../app/api/_lib/sand-provider.ts";
import { studioEngine, engineCost, studioEngines } from "../app/engine-catalog.ts";
import { buildEngineInput, ENGINE_ENDPOINTS } from "../app/engine-providers.ts";
import { isEngineVideoHost } from "../app/api/_lib/engine-hosts.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (init.method === "POST") return new Response(JSON.stringify({ id: "987" }), { status: 202 });
  const id = String(url).split("/").pop();
  const body = id === "1" ? { status: "succeeded", output: { videoUrl: "https://cdn.sand.ai/v.mp4" } } : id === "2" ? { status: "failed", error: { message: "bad photo" } } : { status: "running" };
  return new Response(JSON.stringify(body), { status: 200 });
};

{ delete process.env.SAND_API_KEY;
  await assert.rejects(() => sandCreate({ prompt: "x", image: "https://a/b.jpg", duration: 5, aspect_ratio: "16:9" }), /Sand AI key/); assert.equal(calls.length, 0); ok("without the key nothing is sent"); }
{ process.env.SAND_API_KEY = "test-key";
  const id = await sandCreate({ prompt: "slow push in", image: "https://a/b.jpg", duration: 6, aspect_ratio: "9:16" });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(id, "sand:987"); assert.ok(isSandId(id));
  assert.equal(body.model, "magi-2"); assert.equal(body.generateAudio, false); assert.equal(body.resolution, "1080p"); assert.equal(body.duration, 6); assert.equal(body.aspectRatio, "9:16");
  assert.deepEqual(body.parts[1], { type: "reference_image", image: { url: "https://a/b.jpg" } });
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key"); ok("a scene is sent silent, at 1080p, with the photo link"); }
{ assert.deepEqual(await sandPrediction("sand:1"), { status: "succeeded", output: "https://cdn.sand.ai/v.mp4" });
  assert.deepEqual(await sandPrediction("sand:2"), { status: "failed", error: "bad photo" });
  assert.equal((await sandPrediction("sand:3")).status, "processing"); ok("Sand AI answers are read in Replicate's shape"); }
{ const engine = studioEngine("magi2");
  assert.ok(!engine.unavailable, "switched on"); assert.ok(studioEngines.filter((e) => !e.unavailable).some((e) => e.key === "magi2"));
  assert.equal(Math.round(engineCost("magi2", "1080p", 20) * 100), 160); assert.ok(ENGINE_ENDPOINTS.magi2.startsWith("https://api.sand.ai"));
  assert.equal(buildEngineInput("magi2", { imageUrl: "u", prompt: "p", duration: 5, resolution: "1080p", aspectRatio: "16:9" }).image, "u");
  assert.ok(isEngineVideoHost("cdn.sand.ai") && !isEngineVideoHost("evilsand.ai")); ok("catalog: $0.08 a second, switched on, video host allowed"); }
console.log(`${n} passed, 0 failed`);
