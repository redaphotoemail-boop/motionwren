import type { StudioEngineKey } from "../../engine-catalog";

/* Server-side production for every multi-scene video (customer orders and
   Studio tests). Each job keeps a manifest in R2 with exactly what was sent
   to the engine for every scene, so a scene that fails — or hangs — is
   started again on its own (up to MAX_ATTEMPTS) instead of failing the whole
   video. Nothing depends on a browser staying open: provider webhooks, and
   any page that checks on the job, move it forward; the finished film is
   joined and saved to History on the server. */

export const MAX_ATTEMPTS = 3; // first try + two automatic retries per scene
export const STALE_SCENE_MS = 20 * 60 * 1000; // a scene running this long is restarted

export type SceneState = "waiting" | "creating" | "ready" | "retrying" | "failed";

export type ProductionManifest = {
  version: 1;
  engine: StudioEngineKey;
  endpoint: string;
  sceneSeconds: number;
  inputs: Record<string, unknown>[];
  attempts: number[];
  startedAt: number[];
  states: SceneState[];
  lastErrors: string[];
  audio?: { mode: "silent" | "single_master"; direction?: string; voiceoverScript?: string }; // how the joined film's sound is made
  stitchAttempts?: number;
};

type R2Env = { BUCKET: R2Bucket };
type JobEnv = R2Env & { DB: D1Database };

const manifestKey = (jobId: string) => `render-jobs/${jobId}/manifest.json`;
export const frameKey = (jobId: string, index: number) => `render-jobs/${jobId}/scene-${String(index + 1).padStart(2, "0")}.jpg`;

export async function loadManifest(env: R2Env, jobId: string): Promise<ProductionManifest | null> {
  try {
    const object = await env.BUCKET.get(manifestKey(jobId));
    if (!object) return null;
    const data = JSON.parse(await object.text()) as ProductionManifest;
    return data && data.version === 1 && Array.isArray(data.inputs) ? data : null;
  } catch {
    return null;
  }
}

export async function saveManifest(env: R2Env, jobId: string, manifest: ProductionManifest) {
  await env.BUCKET.put(manifestKey(jobId), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
}

export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/* A Studio scene's photo, stored with the job so a scene can be made again
   without the browser. Older Studio pages send it as a data URL. */
export async function storeFrame(env: R2Env, jobId: string, index: number, dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error(`Scene ${index + 1} has no valid image.`);
  await storeFrameBytes(env, jobId, index, fromBase64(match[2]), match[1]);
}

export async function storeFrameBytes(env: R2Env, jobId: string, index: number, bytes: ArrayBuffer | Uint8Array, contentType: string) {
  if (!bytes.byteLength || bytes.byteLength > MAX_FRAME_BYTES) throw new Error(`Scene ${index + 1}'s photo is empty or too large.`);
  await env.BUCKET.put(frameKey(jobId, index), bytes, { httpMetadata: { contentType } });
}

/* Which of a job's scene photos have arrived. */
export async function framesPresent(env: R2Env, jobId: string, count: number) {
  return Promise.all(Array.from({ length: count }, async (_, index) => Boolean(await env.BUCKET.head(frameKey(jobId, index)))));
}

type NodeBuffer = { from(value: ArrayBuffer | Uint8Array | string, encoding?: string): Uint8Array & { toString(encoding: string): string } };
const nodeBuffer = (globalThis as { Buffer?: NodeBuffer }).Buffer;
function fromBase64(value: string): Uint8Array {
  if (nodeBuffer) return new Uint8Array(nodeBuffer.from(value, "base64"));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function toBase64(bytes: Uint8Array): string {
  if (nodeBuffer) return nodeBuffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/* What the engine actually receives for a Studio scene. Tries 1 and 3 hand
   over the photo itself (inline, the way the Studio has always worked with
   every engine); try 2 hands over a private link to the stored copy instead,
   so a scene the engine rejected one way gets the other. Client orders (no
   stored Studio photo) are sent unchanged. */
export async function engineInputFor(env: R2Env, jobId: string, index: number, input: Record<string, unknown>, attempt: number): Promise<Record<string, unknown>> {
  if (attempt === 2) return input;
  const marker = `/api/job-frames/${jobId}/`;
  if (!Object.values(input).some((value) => typeof value === "string" && value.includes(marker))) return input;
  const object = await env.BUCKET.get(frameKey(jobId, index));
  if (!object) return input;
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (bytes.byteLength > 1_400_000) return input;
  const dataUrl = `data:${object.httpMetadata?.contentType || "image/jpeg"};base64,${toBase64(bytes)}`;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "string" && value.includes(marker) ? dataUrl : value]));
}

export async function deleteFrames(env: R2Env, jobId: string, count: number) {
  await Promise.allSettled(Array.from({ length: count }, (_, index) => env.BUCKET.delete(frameKey(jobId, index))));
}

/* Starts one prediction. A refused start is tried once more after a short
   pause (the provider occasionally answers a burst of starts with 429/5xx). */
export async function startScene(token: string, endpoint: string, input: Record<string, unknown>, webhook?: string): Promise<string> {
  let lastError = "The scene could not start.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ input, ...(webhook ? { webhook, webhook_events_filter: ["completed"] } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok && typeof data.id === "string") return data.id;
      lastError = String(data.detail || data.error || `The engine refused the scene (${response.status}).`);
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break; // a bad request will not improve
    } catch (error) {
      // A network failure (not an answer from the engine): say so plainly.
      lastError = `The video engine could not be reached${error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : ""}.`;
    }
  }
  throw new Error(lastError);
}

/* Starts every scene not started yet and moves the job to "generating".
   The job row must already exist (callbacks can arrive within seconds). Each
   started scene is recorded at once, so if this request is cut off (a page
   refresh, a dropped connection) the next check carries on from the same
   point instead of losing or repeating paid work. If a scene cannot start at
   all, the ones already started are cancelled and the error is thrown. */
export async function startProductionScenes(env: JobEnv, token: string, jobId: string, manifest: ProductionManifest, webhook: string | undefined, already: string[] = []) {
  const ids = [...already];
  for (let index = 0; index < ids.length; index += 1) {
    if (!manifest.attempts[index]) { manifest.attempts[index] = 1; manifest.startedAt[index] = Date.now(); manifest.states[index] = "creating"; }
  }
  await saveManifest(env, jobId, manifest);
  try {
    for (let index = ids.length; index < manifest.inputs.length; index += 1) {
      try { ids.push(await startScene(token, manifest.endpoint, await engineInputFor(env, jobId, index, manifest.inputs[index], 1), webhook)); }
      catch (error) { throw new Error(`Scene ${index + 1} could not be started: ${error instanceof Error ? error.message : "the engine refused it"}`); }
      manifest.attempts[index] = 1;
      manifest.startedAt[index] = Date.now();
      manifest.states[index] = "creating";
      await env.DB.prepare(`UPDATE render_jobs SET prediction_ids = ?, updated_at = ? WHERE id = ? AND status = 'starting'`).bind(JSON.stringify(ids), Date.now(), jobId).run();
      await saveManifest(env, jobId, manifest);
    }
  } catch (error) {
    await Promise.allSettled(ids.map((id) => fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })));
    throw error;
  }
  await env.DB.prepare(`UPDATE render_jobs SET status = 'generating', prediction_ids = ?, updated_at = ? WHERE id = ? AND status = 'starting'`).bind(JSON.stringify(ids), Date.now(), jobId).run();
  await env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE render_job_id = ? AND status IN ('queued', 'submitted')`).bind(Date.now(), jobId).run();
  return ids;
}

export function newManifest(engine: StudioEngineKey, endpoint: string, sceneSeconds: number, inputs: Record<string, unknown>[], audio?: ProductionManifest["audio"]): ProductionManifest {
  return {
    ...(audio ? { audio } : {}),
    version: 1,
    engine,
    endpoint,
    sceneSeconds,
    inputs,
    attempts: inputs.map(() => 0),
    startedAt: inputs.map(() => 0),
    states: inputs.map(() => "waiting" as SceneState),
    lastErrors: inputs.map(() => ""),
  };
}
