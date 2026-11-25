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
export const STALE_SCENE_MS = 20 * 60 * 1000; // the longest a scene may run before it is cancelled and tried again (the real limit is shorter, see staleAfterMs)
/* How long a scene may sit with the engine before it is cancelled and sent again. A scene the engine has not even started
   ("starting": queued or booting) gets 6 minutes; one it is running gets 4 minutes plus one per second of video (a 5-second
   scene: 9 minutes), never more than 18. Scenes normally take 1–5 minutes, so waiting 20 minutes on a silent engine was the problem. */
/* Minutes a RUNNING scene may take on engines measured to be fast (Nov 23: H3 Lite 30-45 s, Wan 3.0 ~1.8 min, Hailuo 2.3 ~1.5-2.5 min, H3 ~2.5 min).
   About three times the usual time, so a hung engine is caught in minutes and not after nine. */
const FAST_ENGINE_MINUTES: Record<string, number> = { h3lite: 3, wan3: 6, hailuo23: 6, h3: 7 };
export const staleAfterMs = (status: string, sceneSeconds: number, engine?: string) => {
  if (status === "starting") return 6 * 60 * 1000;
  const general = Math.min(18, 4 + Math.max(3, sceneSeconds));
  const fast = engine ? FAST_ENGINE_MINUTES[engine] : undefined;
  return (fast ? Math.min(general, fast) : general) * 60 * 1000;
};
/* A scene counts as "taking longer than usual" (and shows its Send again button) after this long with the engine. */
export const SLOW_SCENE_MS = 5 * 60 * 1000;

/* queued: waiting its turn · submitting: being sent · creating: with the
   engine · retry: will be sent again at nextAt · ready · failed: tries used
   up. ("waiting"/"retrying" are the same states from older manifests.) */
export type SceneState = "queued" | "submitting" | "creating" | "retry" | "ready" | "failed" | "waiting" | "retrying";
export type WaitReason = "" | "throttle" | "credit" | "retry";

/** The camera moves a "Photo move" film cycles through, one per scene. */
export const PHOTO_MOVE_CYCLE = ["push-rise", "orbit-right", "pull", "orbit-left", "push-right", "pull-rise", "push-left", "push"] as const;

export type ProductionManifest = {
  version: 1;
  /** Set when a stalled scene sent the film to the backup engine: this happens once per film. */
  backupSwitchedAt?: number;
  engine: StudioEngineKey;
  /** The engine the video was started with. `engine` moves when a scene is re-made or sent to the backup engine; History names this one. */
  startedEngine?: StudioEngineKey;
  /** Smart movement: how each photo's camera move was chosen (see movement-read.ts). */
  movementPlan?: { mode: string; used: string; picks: { move: string; why: string }[]; rooms?: string[]; costCents: number; note?: string };
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
  /** The line guard (composer/lines.mjs), per scene in film order: how strict, whether the scene is played backwards
      (the closing pull-back), and the still-photo move used when its lines don't hold. */
  lineGuard?: { modes: ("push" | "arc")[]; reverse: boolean[]; stills: ("push" | "pull" | "slide-left" | "slide-right")[]; off?: boolean };
  /** What the line guard did at the last edit, per scene (1-based): kept the engine's scene ("ai") or used the still-photo move. */
  /** Earlier versions of each scene, newest last (a scene made again keeps the one it replaced, so it can be put back).
      Stored next to the film as take-NN-K.mp4. */
  takes?: { file: string; at: number }[][];
  /** Scene remakes a customer has used on this film (see CUSTOMER_REMAKES). */
  customerRemakes?: number;
  lineGuardResult?: { scene: number; used: "ai" | "still"; reversed?: boolean; stabilized?: boolean; reason: string }[];
  /** Studio Ads: this job is a commercial, not a real-estate film. The
      pipeline treats it so: the composer edits even a single clip, and the
      film-review reality check (which flags anything added or changed
      versus the source photo) is skipped. */
  ads?: boolean;
  /** Photo move 2.0: real depth for every scene, never a flat zoom. */
  photoStrict?: boolean;
  /** Photo move 3.0: metric depth. */
  photoMetric?: boolean;
  /** Photo move 3.0: AI refining over the measured move (with the straightness guard). */
  photoHybrid?: boolean;
  /** The opening property card and closing agent card, burned into the film by the editor. */
  cards?: ListingCards;
  /** What the editor did with the cards: "added", or why they were left off. */
  cardsNote?: string;
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
  qc?: import("./composer").FilmCheck;
  aiReview?: import("./film-review").AiReview;
  /** How many frames of each scene the AI review looked at in the last check (so a clean scene still shows that it was checked). */
  checkedFrames?: number[];
  /** What the engine last reported for each scene and since when ("starting" = queued or booting, "processing" = running). */
  engineSeen?: { status: string; since: number }[];
  /* The fix loop: a flagged scene is made again with an ADDED instruction (notes[scene]);
     the scene's own prompt in `inputs` is never edited. round counts re-makes (at most MAX_FIX_ROUNDS). */
  /** A film made from clips of earlier films (Studio "Use saved clips"): no engine was used, so the quality check never re-makes anything. */
  fromClips?: { jobId: string; scene: number }[];
  /** When every clip came from one film ("Make versions" in Edit film): that film's job id, so History can group the version with its original. */
  sourceFilmId?: string;
  /** History ids of the later versions of this film (each edit saves a new one); the first version keeps the job's own id. */
  versions?: string[];
  /** Edits submitted while the film was busy, waiting in line (the submission queue): each runs in order when the film before it finishes. A queued edit is never dropped silently — it waits, runs, or fails loudly. */
  editQueue?: QueuedEdit[];
  /** "Original photo shape": the film is made at this shape (width ÷ height), the shape of the photos themselves. */
  frame?: { ratio: number };
  fix?: { round: number; firstEngine?: string; notes: string[]; history: { round: number; scenes: number[]; why: string; cents?: number; engine?: string; at?: number }[];
    /** The exact instruction written for each re-made scene, and who asked for it (the automatic check, or the owner's "Fix this scene" tap). */
    sent?: { round: number; scene: number; text: string; by: "check" | "you"; engine?: string }[];
    /** Scene clips the quality check flagged and that were then re-made (kept so they can be previewed), and the flagged scenes of the film as delivered. */
    kept?: { scene: number; round: number; file: string; issues: string[] }[]; flagged?: { scene: number; issues: string[] }[] };
  upscale?: { to: "1080p"; stored?: boolean; predictionId?: string; startedAt?: number; tries?: number; done?: boolean; skipped?: string; lastError?: string };
  /* The final edit by our composer (composer.ts): each scene's share of the
     film on screen, the crossfade, and the film's ONE music track — its
     prompt, and once made, our stored copy (so a re-edit keeps the same
     music). key/attempt/startedAt describe the edit in progress. */
  edit?: {
    shareSeconds?: number;
    crossfade?: number;
    /** A library template applied to this film: its colour grade (cuts, text and music are in the other edit fields). */
    grade?: "warm";
    /** A WrenCut template applied to this film: the recipe of shots, joins, zoom and colour. It decides the film's length. */
    recipe?: import("../../wrencut").WrenRecipe;
    /** A template recipe (spec v1) applied to this film: the frozen JSON
        from composer/templates/*.json. It decides the film's length. */
    templateRecipe?: Record<string, unknown>;
    /** Cinematic titles typed in the Studio: words at the start and/or end, in one of five fonts. */
    titles?: import("../../titles").FilmTitles;
    /** What the film was made with, shown in History: the template's name, and whether it was made from saved clips. */
    templateName?: string;
    /** With a recipe: edit from only these scenes (by index), in this order. */
    useScenes?: number[];
    /** The order the scenes play in, as scene indexes (a customer's reorder after delivery). Left out: as made. */
    order?: number[];
    /** The finished film is cut to this frame instead of the one it was made at (nothing is made again). */
    reframe?: "horizontal" | "vertical" | "square" | "portrait";
    music?: { prompt: string; saved?: string; source?: string; libraryId?: string; seconds?: number };
    /** Studio Ads: subtitle lines to burn in (position + size), and a
        voiceover track already stored in R2 (voiceover.mp3), mixed over
        the music by the composer. */
    subtitles?: { lines: { start: number; end: number; text: string; position?: "bottom" | "top" | "center"; size?: "small" | "medium" | "large" }[]; position?: "bottom" | "top"; size?: "small" | "medium" | "large" };
    voiceover?: { saved?: string };
    /** A film's own voice and sound effects, made at the final edit. voice.mode "scene": one line per
        scene, each placed at its scene; "film": one script read across the whole film (voice-01.mp3).
        tracks hold file names in the job's folder ("" = none for that scene). noMusic: the film is edited with no music. */
    sound?: { noMusic?: boolean; voice?: { mode: "scene" | "film"; voiceId: string; lines: string[]; tracks: string[] }; sfx?: { prompts: string[]; tracks: string[] }; /** A WrenCut template's effects on its cuts: one stored sound per kind, placed at times (seconds). */ cutfx?: { files: Record<string, string>; hits: { file: string; at: number }[] } };
    key?: string;
    attempt?: number;  // every edit ever started for this film (keys are never reused)
    tries?: number;    // edits tried for the current version of the film
    startedAt?: number;
    lastError?: string;
    usedBackupJoiner?: boolean;
  };
};

/** One edit waiting in the submission queue. `body` is the exact Edit POST body as submitted (a new photo for a scene is already moved to R2 at queue time — see queuedPhotoKey — so the body never carries photo bytes). `status` is "waiting" while the edit is in line; the queue marks it "held" when the film it waits on has stopped, and it waits again (never dropped) once the film runs. */
export type QueuedEdit = {
  id: string;
  body: Record<string, unknown>;
  label: string;
  status: "waiting" | "held";
  holdReason?: string;
  submittedAt: number;
};

type R2Env = { BUCKET: R2Bucket };

const manifestKey = (jobId: string) => `render-jobs/${jobId}/manifest.json`;
export const frameKey = (jobId: string, index: number) => `render-jobs/${jobId}/scene-${String(index + 1).padStart(2, "0")}.jpg`;
export const outputKey = (jobId: string, index: number) => `render-jobs/${jobId}/out-${String(index + 1).padStart(2, "0")}.mp4`;
/** A new photo for a queued edit, waiting in R2 until that edit runs (so the queued body never has to carry the photo bytes). */
export const queuedPhotoKey = (jobId: string, queueId: string, index: number) => `render-jobs/${jobId}/queued-${queueId}-scene-${String(index + 1).padStart(2, "0")}.jpg`;
export const musicKey = (jobId: string) => `render-jobs/${jobId}/music.mp3`;
export const voiceoverKey = (jobId: string) => `render-jobs/${jobId}/voiceover.mp3`;

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
   (the caller saves it).
   Vidu fetches the photo from its own servers, which cannot read Replicate's file store (it answered "User Input Error"
   in 12 seconds), so it is handed our private link from the first try. */
const READS_PRIVATE_LINK = new Set(["vidu3turbo"]);
async function baseEngineInput(env: R2Env, token: string, jobId: string, manifest: ProductionManifest, index: number, attempt: number): Promise<Record<string, unknown>> {
  const input = manifest.inputs[index];
  const photo = manifest.photos?.[index];
  if (!photo) return legacyInput(env, jobId, index, input, attempt);
  const swap = (value: string) => Object.fromEntries(Object.entries(input).map(([key, current]) => [key, current === photo.link ? value : current]));
  if (attempt === 2 || (attempt === 1 && READS_PRIVATE_LINK.has(String(manifest.engine)))) return input;
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
    startedEngine: engine,
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

/* Orbits, lateral slides and pans reveal parts of the room the photo never
   showed, and that is where an engine invents things. These scenes play a
   little slower in the edit: the camera covers less of the room and what is
   shown is the part the engine kept faithful. Pushes and pulls stay as made.
   The scene's own prompt is never changed. */
export const SIDEWAYS_SPEED = 0.7;
export const isSidewaysMove = (prompt: unknown) => typeof prompt === "string" && /lateral slide|horizontal lateral|orbit|\bpan(s|ning)?\b/i.test(prompt);

export const MAX_FIX_ROUNDS = 2; // at most three attempts: the first, then two re-makes that each carry a fix for what the check found

/* Where a film stands after the quality check, for History: "flagged" = still has a problem after the last attempt (needs the owner),
   "fixed" = had a problem, was re-made and the re-check passed, "approved" = passed first time, "unchecked" = no check ran. */
export type QualityState = { state: "flagged" | "fixed" | "approved" | "unchecked"; attempts: number; issues: number };
export function qualityState(manifest: ProductionManifest | null | undefined): QualityState {
  const attempts = (manifest?.fix?.round || 0) + 1;
  const issues = manifest?.fix?.flagged?.length || 0;
  if (issues) return { state: "flagged", attempts, issues };
  if (!manifest?.qc && !manifest?.aiReview) return { state: "unchecked", attempts, issues: 0 };
  return { state: attempts > 1 ? "fixed" : "approved", attempts, issues: 0 };
}

/* The input the engine receives: the scene's own input, plus (only in a fix) the extra instruction after it. */
export async function engineInputFor(env: R2Env, token: string, jobId: string, manifest: ProductionManifest, index: number, attempt: number): Promise<Record<string, unknown>> {
  const input = await baseEngineInput(env, token, jobId, manifest, index, attempt);
  const note = manifest.fix?.notes?.[index];
  if (!note || typeof input.prompt !== "string") return input;
  return { ...input, prompt: `${input.prompt.slice(0, 3600)} ${note}` };
}
