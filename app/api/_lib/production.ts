import type { StudioEngineKey } from "../../engine-catalog";
import { providerUrl } from "./provider";

/* Server-side production for every multi-scene video (client orders and
   Studio videos). Each job keeps a manifest in R2 — durable storage that
   survives refreshes, redeploys and restarts — with, per scene: the exact
   engine request (prompt and settings snapshot), its photo, its state,
   tries, next allowed time, last provider error and finished output. The
   job row in D1 holds each scene's provider prediction ID (aligned by scene)
   and finished output URL. The queue that moves scenes along is in
   scene-queue.ts. */

export const MAX_ATTEMPTS = 3; // tries per scene (a provider "slow down" is a wait, not a try)
export const STALE_SCENE_MS = 20 * 60 * 1000; // a scene running this long is cancelled and tried again

/* queued: waiting its turn · submitting: being sent · creating: with the
   engine · retry: will be sent again at nextAt · ready · failed: tries used
   up. ("waiting"/"retrying" are the same states from older manifests.) */
export type SceneState = "queued" | "submitting" | "creating" | "retry" | "ready" | "failed" | "waiting" | "retrying";
export type WaitReason = "" | "throttle" | "credit" | "retry";

/** The camera moves a "Photo move" film cycles through, one per scene. */
export const PHOTO_MOVE_CYCLE = ["push-rise", "orbit-right", "pull", "orbit-left", "push-right", "pull-rise", "push-left", "push"] as const;

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
  /* Each scene's photo: where it is stored (R2), the private link to it that
     is written in the scene's input, and its copy in the engine's own file
     storage once uploaded. */
  photos?: { key: string; link: string; file?: string }[];
  /** Set for "Photo move" films: scene i is the original photo with this camera move, made by the editor (no AI clip). */
  photoMoves?: string[];
  /** The opening property card and closing agent card, burned into the film by the editor. */
  cards?: ListingCards;
  nextAt?: number[];      // earliest time the scene may be sent (again)
  waits?: number[];       // provider waits/hiccups since the last try (not tries)
  reasons?: WaitReason[]; // why a scene is waiting, for the progress view
  outputs?: string[];     // finished scene video from the engine
  readyAt?: number[];     // when the scene finished (engine copies expire after ~1 hour)
  saved?: string[];       // our durable copy of the finished scene (R2 key)
  finalUrl?: string;      // the joined film, while it is being saved to History
  /* Engines that make 720p: the edited film is upscaled to 1080p before it is saved.
     stored: our copy of the edited film (the upscaler reads it) · predictionId: the upscale in progress ·
     skipped: why the 720p film was kept instead. */
  upscale?: { to: "1080p"; stored?: boolean; predictionId?: string; startedAt?: number; tries?: number; done?: boolean; skipped?: string; lastError?: string };
  /* The final edit by our composer (composer.ts): each scene's share of the
     film on screen, the crossfade, and the film's ONE music track — its
     prompt, and once made, our stored copy (so a re-edit keeps the same
     music). key/attempt/startedAt describe the edit in progress. */
  edit?: {
    shareSeconds?: number;
    crossfade?: number;
    music?: { prompt: string; saved?: string; source?: string };
    key?: string;
    attempt?: number;  // every edit ever started for this film (keys are never reused)
    tries?: number;    // edits tried for the current version of the film
    startedAt?: number;
    lastError?: string;
    usedBackupJoiner?: boolean;
  };
};

type R2Env = { BUCKET: R2Bucket };

const manifestKey = (jobId: string) => `render-jobs/${jobId}/manifest.json`;
export const frameKey = (jobId: string, index: number) => `render-jobs/${jobId}/scene-${String(index + 1).padStart(2, "0")}.jpg`;
export const outputKey = (jobId: string, index: number) => `render-jobs/${jobId}/out-${String(index + 1).padStart(2, "0")}.mp4`;
export const musicKey = (jobId: string) => `render-jobs/${jobId}/music.mp3`;

/* Fills fields older manifests do not have, so every job runs on the queue. */
export function normalizeManifest(manifest: ProductionManifest) {
  const n = manifest.inputs.length;
  const fill = <T,>(list: T[] | undefined, value: T) => Array.from({ length: n }, (_, index) => list && list[index] !== undefined && list[index] !== null ? list[index] : value);
  manifest.attempts = fill(manifest.attempts, 0);
  manifest.startedAt = fill(manifest.startedAt, 0);
  manifest.lastErrors = fill(manifest.lastErrors, "");
  manifest.states = fill(manifest.states, "queued" as SceneState).map((state) => state === "waiting" ? "queued" : state === "retrying" ? "retry" : state);
  manifest.nextAt = fill(manifest.nextAt, 0);
  manifest.waits = fill(manifest.waits, 0);
  manifest.reasons = fill(manifest.reasons, "" as WaitReason);
  manifest.outputs = fill(manifest.outputs, "");
  manifest.readyAt = fill(manifest.readyAt, 0);
  manifest.saved = fill(manifest.saved, "");
  return manifest as Required<ProductionManifest>;
}

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

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

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

/* Uploads a stored photo to the engine's own file storage and returns the
   address the engine reads it from. This is how Replicate's official tools
   hand files to every model, at any size, without the engine having to reach
   our site. */
async function engineFile(env: R2Env, token: string, key: string): Promise<string> {
  const object = await env.BUCKET.get(key);
  if (!object) throw new Error("The scene's photo is no longer stored.");
  const type = object.httpMetadata?.contentType || "image/jpeg";
  const form = new FormData();
  form.append("content", new Blob([await new Response(object.body).arrayBuffer()], { type }), `scene.${type.split("/")[1] === "png" ? "png" : type.split("/")[1] === "webp" ? "webp" : "jpg"}`);
  const response = await fetch(providerUrl("https://api.replicate.com/v1/files"), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await response.json().catch(() => ({})) as { urls?: { get?: unknown } };
  if (!response.ok || typeof data.urls?.get !== "string") throw new Error(`The photo could not be handed to the engine (${response.status}).`);
  return data.urls.get;
}

async function inlinePhoto(env: R2Env, key: string, limit: number): Promise<string | null> {
  const object = await env.BUCKET.get(key);
  if (!object) return null;
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return bytes.byteLength <= limit ? `data:${object.httpMetadata?.contentType || "image/jpeg"};base64,${toBase64(bytes)}` : null;
}

/* What the engine actually receives for a scene, by try:
   1 — the photo from the engine's own file storage (works for every engine);
   2 — the private link to our stored copy;
   3 — the photo inline when it is small, otherwise a fresh upload.
   Each way fails over to the next, so one way of handing over the photo
   failing can never sink a scene. The manifest remembers the uploaded copy
   (the caller saves it). */
export async function engineInputFor(env: R2Env, token: string, jobId: string, manifest: ProductionManifest, index: number, attempt: number): Promise<Record<string, unknown>> {
  const input = manifest.inputs[index];
  const photo = manifest.photos?.[index];
  if (!photo) return legacyInput(env, jobId, index, input, attempt);
  const swap = (value: string) => Object.fromEntries(Object.entries(input).map(([key, current]) => [key, current === photo.link ? value : current]));
  if (attempt === 2) return input;
  if (attempt >= 3) {
    const inline = await inlinePhoto(env, photo.key, 1_000_000).catch(() => null);
    if (inline) return swap(inline);
    photo.file = undefined;
  }
  try {
    photo.file = photo.file || await engineFile(env, token, photo.key);
    return swap(photo.file);
  } catch {
    const inline = await inlinePhoto(env, photo.key, 1_000_000).catch(() => null);
    return inline ? swap(inline) : input;
  }
}

/* Studio videos started before photos were recorded in the manifest. */
async function legacyInput(env: R2Env, jobId: string, index: number, input: Record<string, unknown>, attempt: number) {
  if (attempt === 2) return input;
  const marker = `/api/job-frames/${jobId}/`;
  if (!Object.values(input).some((value) => typeof value === "string" && value.includes(marker))) return input;
  const inline = await inlinePhoto(env, frameKey(jobId, index), 1_400_000).catch(() => null);
  return inline ? Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "string" && value.includes(marker) ? inline : value])) : input;
}

/* Every working file of a job (scene photos, kept scene copies, manifest). */
export async function deleteJobFiles(env: R2Env, jobId: string) {
  const listed = await env.BUCKET.list({ prefix: `render-jobs/${jobId}/` });
  const keys = listed.objects.map((object: { key: string }) => object.key);
  if (keys.length) await env.BUCKET.delete(keys);
}

export async function deleteFrames(env: R2Env, jobId: string, count: number) {
  await Promise.allSettled(Array.from({ length: count }, (_, index) => env.BUCKET.delete(frameKey(jobId, index))));
}

export function newManifest(engine: StudioEngineKey, endpoint: string, sceneSeconds: number, inputs: Record<string, unknown>[], audio?: ProductionManifest["audio"], photos?: ProductionManifest["photos"]): ProductionManifest {
  return {
    ...(audio ? { audio } : {}),
    ...(photos ? { photos } : {}),
    version: 1,
    engine,
    endpoint,
    sceneSeconds,
    inputs,
    attempts: inputs.map(() => 0),
    startedAt: inputs.map(() => 0),
    states: inputs.map(() => "queued" as SceneState),
    lastErrors: inputs.map(() => ""),
    nextAt: inputs.map(() => 0),
    waits: inputs.map(() => 0),
    reasons: inputs.map(() => "" as WaitReason),
    outputs: inputs.map(() => ""),
    readyAt: inputs.map(() => 0),
    saved: inputs.map(() => ""),
  };
}

export type ListingCards = {
  opening?: { title: string; detail: string; message: string } | null;
  closing?: { name: string; contact: string; logo: string } | null;
};

/* The cards the Studio sent, trimmed to safe sizes; undefined when there is nothing to show. */
export function cleanCards(value: unknown): ListingCards | undefined {
  if (!value || typeof value !== "object") return undefined;
  const text = (input: unknown, max: number) => typeof input === "string" ? input.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  const raw = value as { opening?: Record<string, unknown> | null; closing?: Record<string, unknown> | null };
  const o = raw.opening || {}, c = raw.closing || {};
  const opening = { title: text(o.title, 80), detail: text(o.detail, 140), message: text(o.message, 120) };
  const logo = typeof c.logo === "string" && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(c.logo) && c.logo.length < 3_000_000 ? c.logo : "";
  const closing = { name: text(c.name, 80), contact: text(c.contact, 140), logo };
  const hasOpening = Boolean(opening.title || opening.detail || opening.message);
  const hasClosing = Boolean(closing.name || closing.contact || closing.logo);
  if (!hasOpening && !hasClosing) return undefined;
  return { opening: hasOpening ? opening : null, closing: hasClosing ? closing : null };
}
