/* The site's side of the composer — our own final edit, running in a
   Cloudflare Container next to this Worker (composer/server.mjs, class
   Composer in worker/composer.ts). One container instance per film.

   Every multi-scene film is edited there: the scenes are trimmed to their
   share of the film and cross-dissolved, the engine's per-scene sound is
   dropped, and ONE music track (ElevenLabs Music, backup Stable Audio 2.5)
   runs under the whole film. If the container binding is missing (local dev,
   or before the first container deploy), films use the backup joiner. */

import { SAMPLE_SECONDS, defaultMusicId, musicTemplate } from "../../music-catalog";

type Stub = { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
type Namespace = { getByName?: (name: string) => Stub; idFromName: (name: string) => unknown; get: (id: unknown) => Stub };

export type EditSpec = {
  clips: string[];
  width: number;
  height: number;
  duration: number;
  sceneSeconds: number;
  crossfade: number;
  /** Per scene: a camera move made on the photo (the link is the photo), or null for an ordinary clip. */
  moves?: (string | null)[];
  /** Opening property card and closing agent card to burn in. */
  cards?: import("./production").ListingCards;
  /** One clip only: keep its own sound (no music track is added). */
  keepAudio?: boolean;
  music?: { url?: string; prompt?: string; required?: boolean } | null;
};

export type EditState = {
  key: string;
  status: "running" | "done" | "failed" | "unknown";
  stage?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  outputBytes?: number;
  duration?: number;
  musicSource?: string;
  musicError?: string;
  music?: boolean;
};

export function composerBinding(env: unknown): Namespace | null {
  const vars = typeof process !== "undefined" ? process.env || {} : {};
  // Local end-to-end tests: the same composer server run directly (never set in production).
  if (vars.COMPOSER_URL) {
    const base = vars.COMPOSER_URL.replace(/\/$/, "");
    const direct: Stub = { fetch: (input, init) => fetch(String(input).replace("http://composer", base), init) };
    return { idFromName: (name) => name, get: () => direct, getByName: () => direct };
  }
  // Local development otherwise runs without containers (vite.config.ts dev.enable_containers).
  if (vars.COMPOSER_DISABLED === "1") return null;
  const binding = (env as { COMPOSER?: Namespace } | null)?.COMPOSER;
  return binding && typeof binding.idFromName === "function" ? binding : null;
}

function stub(env: unknown, jobId: string) {
  const namespace = composerBinding(env);
  if (!namespace) throw new Error("The editing service is not available.");
  return namespace.getByName ? namespace.getByName(jobId) : namespace.get(namespace.idFromName(jobId));
}

const url = (key: string, suffix = "") => `http://composer/jobs/${key}${suffix}`;

/* Edit keys: the job id without dashes plus the try number — the same key
   twice is the same edit, never two. */
export const editKey = (jobId: string, attempt: number) => `${jobId.replaceAll("-", "")}-${attempt}`;

export async function startEdit(env: unknown, jobId: string, key: string, spec: EditSpec): Promise<EditState> {
  const response = await stub(env, jobId).fetch(url(key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
  const data = await response.json().catch(() => ({})) as EditState & { error?: string };
  if (!response.ok) throw new Error(data.error || `The editing service refused the film (HTTP ${response.status}).`);
  return data;
}

export async function editState(env: unknown, jobId: string, key: string): Promise<EditState> {
  const response = await stub(env, jobId).fetch(url(key));
  if (response.status === 404) return { key, status: "unknown" };
  const data = await response.json().catch(() => null) as EditState | null;
  if (!response.ok || !data) throw new Error(`The editing service did not answer (HTTP ${response.status}).`);
  return data;
}

export async function editFile(env: unknown, jobId: string, key: string, which: "output" | "music") {
  const response = await stub(env, jobId).fetch(url(key, `/${which}`));
  if (!response.ok || !response.body) throw new Error(`The edited ${which === "output" ? "film" : "music"} could not be collected (HTTP ${response.status}).`);
  return response;
}

/* The manager's music check (Production page): a 5-second ElevenLabs track
   made in its own container instance, with no backup. */
export async function checkMusic(env: unknown): Promise<{ ok: boolean; error?: string; duration?: number }> {
  // A fresh instance every time: a running container keeps the keys it
  // started with, so a just-changed key is only seen by a new one.
  const response = await stub(env, `music-check-${Date.now()}`).fetch("http://composer/music-check", { method: "POST" });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; duration?: number } | null;
  if (!response.ok || !data) throw new Error(`The editing service did not answer (HTTP ${response.status}).`);
  return { ok: Boolean(data.ok), ...(data.error ? { error: data.error } : {}), ...(data.duration ? { duration: data.duration } : {}) };
}

/* A customer-facing sample of a music template (an MP3 Response), made in
   its own fresh container instance. ElevenLabs only: no backup. */
export async function makeMusicSample(env: unknown, id: string, prompt: string): Promise<Response> {
  const response = await stub(env, `music-sample-${id}-${Date.now()}`).fetch("http://composer/music-sample", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, seconds: SAMPLE_SECONDS }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `The editing service did not answer (HTTP ${response.status}).`);
  }
  return response;
}

export async function dropEdit(env: unknown, jobId: string, key: string) {
  try { await stub(env, jobId).fetch(url(key), { method: "DELETE" }); } catch { /* the container cleans up when it sleeps */ }
}

/* Streams a response straight into storage when its size is known. */
export async function storeResponse(bucket: R2Bucket, key: string, response: Response, contentType: string) {
  const length = Number(response.headers.get("content-length")) || 0;
  const Fixed = (globalThis as { FixedLengthStream?: new (length: number) => { readable: ReadableStream; writable: WritableStream } }).FixedLengthStream;
  if (length && Fixed && response.body) {
    const { readable, writable } = new Fixed(length);
    const piped = response.body.pipeTo(writable);
    await Promise.all([bucket.put(key, readable, { httpMetadata: { contentType } }), piped]);
  } else {
    await bucket.put(key, await response.arrayBuffer(), { httpMetadata: { contentType } });
  }
  return length;
}

/* ---------- the film's music ---------- */

/* One track per film. The customer's chosen template decides it (see
   app/music-catalog.ts); without a choice it is matched to how the film is
   shown. */
export function musicPrompt({ aspect, duration, choice }: { aspect: string; duration: number; choice?: string | null }) {
  return (musicTemplate(choice) || musicTemplate(defaultMusicId({ aspect, duration })))!.prompt;
}

/* ---------- editing service health (for the manager's Production page) ---------- */

/* musicSource: where the last new music came from ("elevenlabs",
   "stable-audio" or "none"); musicNote: why ElevenLabs was skipped, if it was. */
type EditorState = { lastOkAt: number; lastError: string; lastErrorAt: number; musicSource: string; musicNote: string };
type DbEnv = { DB: D1Database };

export async function readEditorState(env: DbEnv): Promise<EditorState> {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'editor_state'`).first<{ value?: string }>().catch(() => null);
  try { return { lastOkAt: 0, lastError: "", lastErrorAt: 0, musicSource: "", musicNote: "", ...JSON.parse(row?.value || "{}") }; }
  catch { return { lastOkAt: 0, lastError: "", lastErrorAt: 0, musicSource: "", musicNote: "" }; }
}

export async function recordEditorState(env: DbEnv, patch: Partial<EditorState>) {
  const next = { ...await readEditorState(env), ...patch };
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('editor_state', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(next), Date.now()).run().catch(() => undefined);
}
