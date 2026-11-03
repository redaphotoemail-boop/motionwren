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

/* Studio frames arrive as data URLs; engines are handed a private link to a
   stored copy instead (large data URLs inside the request were a source of
   failed scenes). */
export async function storeFrame(env: R2Env, jobId: string, index: number, dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error(`Scene ${index + 1} has no valid image.`);
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  await env.BUCKET.put(frameKey(jobId, index), bytes, { httpMetadata: { contentType: match[1] } });
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
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

/* Saves the manifest, then starts every scene and moves the job to
   "generating". The job row must already exist (webhooks can arrive within
   seconds). If a scene cannot start at all, the ones already started are
   cancelled and the error is thrown for the caller to record. */
export async function startProductionScenes(env: R2Env & { DB: D1Database }, token: string, jobId: string, manifest: ProductionManifest, webhook: string) {
  await saveManifest(env, jobId, manifest);
  const ids: string[] = [];
  try {
    for (let index = 0; index < manifest.inputs.length; index += 1) {
      ids.push(await startScene(token, manifest.endpoint, manifest.inputs[index], webhook));
      manifest.attempts[index] = 1;
      manifest.startedAt[index] = Date.now();
      manifest.states[index] = "creating";
    }
  } catch (error) {
    await Promise.allSettled(ids.map((id) => fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })));
    throw error;
  }
  await saveManifest(env, jobId, manifest);
  await env.DB.prepare(`UPDATE render_jobs SET status = 'generating', prediction_ids = ?, updated_at = ? WHERE id = ? AND status = 'starting'`).bind(JSON.stringify(ids), Date.now(), jobId).run();
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
