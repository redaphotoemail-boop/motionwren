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
  /** When a film is cut to another frame shape: which part of the height is kept (0 = the top, 1 = the bottom; left out = the middle). */
  anchorY?: number;
  /** Per scene: a camera move made on the photo (the link is the photo), or null for an ordinary clip. */
  moves?: (string | null)[];
  /** Opening property card and closing agent card to burn in. */
  cards?: import("./production").ListingCards;
  /** Cinematic titles (typed words) at the start and/or end. */
  titles?: import("../../titles").FilmTitles;
  /** Photo move 2.0: every move needs real depth (no flat fallback) and travels further. */
  strictDepth?: boolean;
  /** Photo move 3.0: depth in true distances (metres) from a metric model. */
  depthMode?: "metric";
  /** Photo move 3.0: AI realism over the measured move, kept only if the straight lines hold. */
  hybrid?: boolean;
  /** One clip only: keep its own sound (no music track is added). */
  keepAudio?: boolean;
  /** Free mechanical quality check (on unless false). */
  qc?: boolean;
  /** Hybrid scenes: the measured (mechanical) clip behind an AI clip; used instead when the AI clip bent its lines. */
  refs?: (string | null)[];
  /** The line guard (composer/lines.mjs), per scene: the photo to check against, how strict, whether the scene is played
      backwards (a closing pull-back), the still-photo move used when it fails, and whether to stabilize (2% trim at most). */
  guard?: { photos: (string | null)[]; modes?: ("push" | "arc")[]; reverse?: boolean[]; fallbacks?: ("push" | "pull" | "slide-left" | "slide-right")[]; stabilize?: boolean };
  /** Per scene playback speed (1 = as made); orbit and pan scenes run slower so less is invented. */
  speeds?: number[];
  /** Keep a few stills of the finished film for the AI review. */
  stills?: boolean | number;
  music?: { url?: string; prompt?: string; required?: boolean } | null;
  /** Studio Ads: subtitle lines to burn in, and a voiceover track (a link
      to the stored MP3) to mix over the music. */
  /** A template's colour grade. */
  grade?: "warm";
  /** A WrenCut template's recipe (shots, joins, zoom, colour); its length decides the film's. */
  recipe?: import("../../wrencut").WrenRecipe;
  /** A template recipe (spec v1: composer/templates/*.json — the frozen
      JSON of scenes, captions, transitions, ramps, grade). Its length
      decides the film's; when set, the composer's template branch runs
      and `recipe` is ignored. When absent, behavior is exactly as today. */
  templateRecipe?: Record<string, unknown>;
  /** How much of the recipe's per-shot camera move to apply (0 to 1). */
  recipeStrength?: number;
  subtitles?: { lines: import("../../ads-creative").SubtitleLine[]; position?: "bottom" | "top"; size?: "small" | "medium" | "large" };
  voiceover?: { url: string };
  /** The film's own voice lines and sound effects, each placed at a time (seconds) and level. */
  layers?: { url: string; at: number; gain: number; kind: "voice" | "sfx" }[];
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
  qc?: FilmCheck;
  stills?: number;
  /** Photo move 3.0: what the AI polish did for each scene. */
  hybrid?: { scene: number; used: "ai" | "measured"; error?: string; mean?: number; min?: number }[];
  depthScenes?: number;
  depthFallbacks?: number;
  depthError?: string;
  cards?: boolean;
  cardsError?: string;
  /** What the line guard did for each scene: kept the engine's scene, or used the still-photo move (and why). */
  lineGuard?: LineGuardRecord[];
};

export type LineGuardRecord = { scene: number; used: "ai" | "still"; mode?: string; reversed?: boolean; stabilized?: boolean; reason?: string; error?: string; verdict?: { held?: boolean; reason?: string; leastCover?: number; moved?: number } };

export type FilmCheck = { status: "pass" | "warn" | "fail" | "error"; flags: { level: "warn" | "fail"; code: string; at?: number; message: string }[]; metrics?: Record<string, number>; error?: string; checkedAt: number };

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

/* Every way the site talks to an editing machine goes through here, so each machine it uses is written down
   (editor_machines) before the call. The watchdog (editor-machines.ts) reads that list to put to sleep any
   machine nobody has used for a while. */
export function machineStub(env: unknown, name: string): Stub {
  const namespace = composerBinding(env);
  if (!namespace) throw new Error("The editing service is not available.");
  const real = namespace.getByName ? namespace.getByName(name) : namespace.get(namespace.idFromName(name));
  return { fetch: async (input, init) => { await noteMachine(env, name); return real.fetch(input, init); } };
}
const stub = machineStub;

const noted = new Map<string, number>();
let machinesTableReady = false;
/* Best effort and bounded: a slow or failing database never holds up or breaks a film. At most one write a
   minute per machine. */
export async function noteMachine(env: unknown, name: string) {
  const db = (env as { DB?: D1Database } | null)?.DB;
  const now = Date.now();
  if (!db || typeof db.prepare !== "function" || now - (noted.get(name) || 0) < 60_000) return;
  noted.set(name, now);
  const write = (async () => {
    if (!machinesTableReady) { await db.prepare(MACHINES_TABLE).run(); machinesTableReady = true; }
    await db.prepare(`INSERT INTO editor_machines (name, last_used) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET last_used = excluded.last_used`).bind(name, now).run();
  })().catch(() => undefined);
  await Promise.race([write, new Promise((resolve) => setTimeout(resolve, 2000))]);
}
export const MACHINES_TABLE = `CREATE TABLE IF NOT EXISTS editor_machines (name TEXT PRIMARY KEY, last_used INTEGER NOT NULL, stopped_at INTEGER)`;

const url = (key: string, suffix = "") => `http://composer/jobs/${key}${suffix}`;

/* Every reply from the container must be read or let go. The container stays
   awake (and billed) while a reply it sent is still unread, so an unread reply
   kept machines on for days. */
export async function release(response: Response | null | undefined) {
  try { await response?.body?.cancel(); } catch { /* already read */ }
}

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
  if (response.status === 404) { await release(response); return { key, status: "unknown" }; }
  const data = await response.json().catch(() => null) as EditState | null;
  if (!response.ok || !data) throw new Error(`The editing service did not answer (HTTP ${response.status}).`);
  return data;
}

export async function editFile(env: unknown, jobId: string, key: string, which: "output" | "music" | `still/${number}`) {
  const response = await stub(env, jobId).fetch(url(key, `/${which}`));
  if (!response.ok || !response.body) { await release(response); throw new Error(`The edited ${which === "output" ? "film" : "music"} could not be collected (HTTP ${response.status}).`); }
  return response;
}

/* The manager's music check (Production page): a 5-second ElevenLabs track
   made in its own container instance, with no backup. */
/* OpenCV's numbers for a film's photos (and small copies for the AI reader when asked): the
   container's POST /movements. Photos are given as links the container can open. */
export type MovementRead = { opencv?: string; photos: (import("./movement-plan").Measure & { thumb?: string })[] };
export async function measureMovements(env: unknown, name: string, links: (string | { data: string })[], thumbs: boolean, timeoutMs = 50_000): Promise<MovementRead> {
  const response = await stub(env, `movement-${name}`).fetch("http://composer/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photos: links.map((link) => typeof link === "string" ? { url: link } : { data: link.data }), thumbs }), signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => null) as (MovementRead & { error?: string }) | null;
  if (!response.ok || !data?.photos) throw new Error(data?.error || `The photo reader did not answer (HTTP ${response.status}).`);
  return data;
}

export async function checkMusic(env: unknown): Promise<{ ok: boolean; error?: string; duration?: number }> {
  // A fresh instance every time: a running container keeps the keys it
  // started with, so a just-changed key is only seen by a new one.
  const response = await stub(env, `music-check-${Date.now()}`).fetch("http://composer/music-check", { method: "POST" });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; duration?: number } | null;
  if (!response.ok || !data) throw new Error(`The editing service did not answer (HTTP ${response.status}).`);
  return { ok: Boolean(data.ok), ...(data.error ? { error: data.error } : {}), ...(data.duration ? { duration: data.duration } : {}) };
}

/* Which editor code a brand-new container runs (read-only; no film is made). */
export async function editorBuild(env: unknown): Promise<{ build: string; ffmpeg: string }> {
  const response = await stub(env, `build-check-${Date.now()}`).fetch("http://composer/health");
  const data = await response.json().catch(() => null) as { build?: string; ffmpeg?: string } | null;
  if (!response.ok || !data) throw new Error(`The editing service did not answer (HTTP ${response.status}).`);
  return { build: data.build || "older than the build marker", ffmpeg: data.ffmpeg || "" };
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
  try { await release(await stub(env, jobId).fetch(url(key), { method: "DELETE" })); } catch { /* the container cleans up when it sleeps */ }
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
type EditorState = { lastOkAt: number; lastError: string; lastErrorAt: number; musicSource: string; musicNote: string; polishNote?: string };
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
