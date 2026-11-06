import { getChatGPTUser } from "../../chatgpt-auth";
import { cookies } from "next/headers";
import { customerSafeError } from "./customer-errors";
import { frameKey, framesPresent, loadManifest, musicKey, newManifest, normalizeManifest, saveManifest, type ProductionManifest } from "./production";
import { aiReviewOn, reviewStills } from "./film-review";
import { composerBinding, dropEdit, editFile, editKey, editState, musicPrompt, recordEditorState, startEdit, storeResponse } from "./composer";
import { CROSSFADE_SECONDS, studioEngine, type StudioEngineKey } from "../../engine-catalog";
import { acquireLease, classify, createPrediction, ProviderError, providerUrl, readProviderState, releaseLease, writeProviderState } from "./provider";
import { QUEUE_KINDS, alertManagers, alignedScenes, applyJobAction, stepSceneQueue, stitchSources, type JobAction } from "./scene-queue";

/* Kinds whose scenes are joined with one-second cross-dissolves. */
const CROSSFADE_KINDS = new Set(["customer-series", "studio-series"]);
/* Engine shown in History for jobs made before manifests existed. */
const KIND_ENGINE: Record<string, string> = { "ai-transition": "wan27", "clean-transition": "slideshow", "series-stitch": "stitched" };

export const OWNER_COOKIE = "fm_history_id";
export const ACTIVE_STATUSES = ["starting", "generating", "stitching", "saving"] as const;

export type RenderJobRow = {
  id: string;
  ownerId: string;
  kind: string;
  status: string;
  predictionIds: string;
  segmentUrls: string;
  stitchPredictionId: string | null;
  prompt: string;
  category: string;
  resolution: string;
  aspect: string;
  duration: number;
  costCents: number;
  error: string | null;
  historyId: string | null;
  webhookToken: string | null;
  createdAt: number;
  updatedAt: number;
};

export async function currentOwner(create = false) {
  // Development identity only where trusted; see identityHeadersTrusted().
  const authenticatedId = (await getChatGPTUser())?.id;
  if (authenticatedId) return authenticatedId;
  const store = await cookies();
  return store.get(OWNER_COOKIE)?.value || (create ? crypto.randomUUID() : null);
}

export function setOwnerCookie(response: Response, ownerId: string) {
  const target = response as Response & { cookies?: { set: (name: string, value: string, options: Record<string, unknown>) => void } };
  target.cookies?.set(OWNER_COOKIE, ownerId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export function safeReplicateUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const compositorHost = process.env.COMPOSITOR_API_URL ? new URL(process.env.COMPOSITOR_API_URL).hostname : null;
    // Local end-to-end tests serve "engine" outputs from a mock (never set in production).
    const mockHost = process.env.REPLICATE_API_BASE ? new URL(process.env.REPLICATE_API_BASE).host : null;
    if (mockHost && url.host === mockHost) return url.toString();
    return url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery") || Boolean(compositorHost && url.hostname === compositorHost)) ? url.toString() : null;
  } catch { return null; }
}

export function outputUrl(value: unknown) {
  if (Array.isArray(value)) return safeReplicateUrl(value[0]);
  return safeReplicateUrl(value);
}

export async function replicatePrediction(token: string, id: string): Promise<Record<string, unknown>> {
  // A scene whose restart is being sent right now.
  if (id.startsWith("pending-")) return { status: "starting" };
  // A scene of a stopped video that was picked up again: make it once more.
  if (id.startsWith("resume-")) return { status: "failed", error: "Picked up again." };
  if (id.startsWith("compositor:")) {
    const baseUrl = process.env.COMPOSITOR_API_URL;
    const secret = process.env.COMPOSITOR_API_SECRET;
    if (!baseUrl || !secret) throw new Error("The controlled compositor connection is unavailable.");
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(id.slice(11))}`, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" } });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error((data.error as string) || "Unable to retrieve the compositor job.");
    return { ...data, status: data.status === "complete" ? "succeeded" : data.status, output: data.output_url || data.output };
  }
  const response = await fetch(providerUrl(`https://api.replicate.com/v1/predictions/${id}`), { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error((data.detail as string) || "Unable to retrieve a generation job.");
  return data;
}

export async function cancelProviderJob(token: string, id: string) {
  if (id.startsWith("compositor:")) {
    const baseUrl = process.env.COMPOSITOR_API_URL;
    const secret = process.env.COMPOSITOR_API_SECRET;
    if (!baseUrl || !secret) return;
    await fetch(`${baseUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(id.slice(11))}`, { method: "DELETE", headers: { Authorization: `Bearer ${secret}` } });
    return;
  }
  if (id.startsWith("pending-") || id.startsWith("resume-")) return;
  await fetch(providerUrl(`https://api.replicate.com/v1/predictions/${id}/cancel`), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

export function outputSize(resolution: string, aspect: string) {
  const height = resolution === "1080p" ? 1080 : 720;
  if (aspect === "vertical") return { width: height, height: Math.round(height * 16 / 9) };
  if (aspect === "cinematic") return { width: Math.round(height * 2.39), height };
  return { width: Math.round(height * 16 / 9), height };
}

const CROSSFADE_VERSION = "700f4b0e8fe9957997a9f5046864b787a2b813ac2dc8b84d08eac8af7b663b37";

export type StitchAudioMode = "silent" | "single_master";

export async function startStitch(token: string, videos: string[], resolution: string, aspect: string, crossfadeSeconds = 0, webhookUrl?: string, targetDuration?: number, audio: { mode?: StitchAudioMode; direction?: string; voiceoverScript?: string } = {}) {
  const audioMode = audio.mode === "single_master" ? "single_master" : "silent";
  const audioDirection = typeof audio.direction === "string" ? audio.direction.slice(0, 1200) : "";
  const voiceoverScript = typeof audio.voiceoverScript === "string" ? audio.voiceoverScript.slice(0, 2000) : "";
  const compositorUrl = process.env.COMPOSITOR_API_URL;
  const compositorSecret = process.env.COMPOSITOR_API_SECRET;
  if (compositorUrl && compositorSecret) {
    try {
      const response = await fetch(`${compositorUrl.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${compositorSecret}`, "Content-Type": "application/json", "Idempotency-Key": await compositorKey(videos, crossfadeSeconds) },
        body: JSON.stringify({ pipeline_version: process.env.COMPOSITOR_API_VERSION || "fm-ffmpeg-1.0.0", videos, width: outputSize(resolution, aspect).width, height: outputSize(resolution, aspect).height, fps: 24, video_codec: "h264", audio_codec: "aac", pixel_format: "yuv420p", color_space: "bt709", crossfade_seconds: crossfadeSeconds, audio_crossfade: audioMode === "single_master", audio_mode: audioMode, audio_source: audioMode === "single_master" ? "first_video_track" : "none", audio_loop: audioMode === "single_master", audio_direction: audioDirection || undefined, voiceover_script: voiceoverScript || undefined, loudness_lufs: -14, target_duration_seconds: targetDuration, output_format: "mp4", validate_output: true, callback_url: webhookUrl }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (response.ok && typeof data.id === "string") return `compositor:${data.id}`;
    } catch { /* The managed external processor below is the automatic fallback. */ }
  }
  // The managed fallback cannot build one continuous master track. Mute its
  // output for audio-requested series rather than exposing mismatched music
  // from individual provider clips.
  if (crossfadeSeconds > 0) {
    // This version's schema requires both "task" and "input_file" (a URI),
    // even for composeVideosSeamlessly, which reads its clips from urls_csv.
    // Without input_file every join was refused ("input_file is required").
    const response = await fetch(providerUrl("https://api.replicate.com/v1/predictions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: CROSSFADE_VERSION,
        input: {
          task: "composeVideosSeamlessly",
          input_file: videos[0],
          urls_csv: videos.join(","),
          crossfade_duration: Math.max(0.25, Math.min(2, crossfadeSeconds)),
          fps: 24,
          mute: audioMode === "single_master",
        },
        ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ["completed"] } : {}),
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof data.id !== "string") throw classify(response.status, String(data.detail || data.error || "The server could not start crossfade editing."), response);
    return data.id;
  }
  const size = outputSize(resolution, aspect);
  const response = await fetch(providerUrl("https://api.replicate.com/v1/models/bitflow/video-concat-safe-pro/predictions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { videos, fps: 24, width: size.width, height: size.height, scale_mode: "crop-fill", mute: false }, ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ["completed"] } : {}) }),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof data.id !== "string") throw classify(response.status, String(data.detail || data.error || "The server could not start stitching."), response);
  return data.id;
}

async function compositorKey(videos: string[], crossfadeSeconds: number) {
  const bytes = new TextEncoder().encode(JSON.stringify({ videos, crossfadeSeconds }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function saveFinishedJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, sourceUrl: string) {
  if (row.historyId) return row.historyId;
  const source = safeReplicateUrl(sourceUrl);
  if (!source) throw new Error("The finished video URL is invalid.");
  const upstream = await fetch(source);
  if (!upstream.ok || !upstream.body) throw new Error("The finished video could not be stored.");
  return storeFinishedFilm(env, row, upstream, source);
}

/* Stores a finished film (from the engine or our composer) in History and
   marks the job, its order and the client's notification done. */
async function storeFinishedFilm(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, upstream: Response, source: string) {
  if (row.historyId) return row.historyId;
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const sizeBytes = Number(upstream.headers.get("content-length")) || null;
  if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") throw new Error("The compositor returned a non-video file.");
  if (sizeBytes !== null && (sizeBytes < 10_000 || sizeBytes > 2 * 1024 * 1024 * 1024)) throw new Error("The finished video failed output-size validation.");
  // A film made again (a regenerated scene, re-joined) is a new version in History.
  const existing = await env.DB.prepare(`SELECT id FROM generation_history WHERE id = ?`).bind(row.id).first();
  const historyId = existing ? crypto.randomUUID() : row.id;
  const manifest = await loadManifest(env, row.id);
  const engine = manifest?.engine || KIND_ENGINE[row.kind] || "studio";
  const r2Key = `generation-history/${row.ownerId}/${historyId}.mp4`;
  // A response with a known size streams straight into storage; one without
  // (chunked) is read in full first, since storage needs the size up front.
  await storeResponse(env.BUCKET, r2Key, upstream, contentType === "application/octet-stream" ? "video/mp4" : contentType);
  try {
    const now = Date.now();
    const expiresAt = now + 90 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(historyId, row.ownerId, r2Key, row.prompt, engine, row.category, row.resolution, row.aspect, row.duration, row.costCents, sizeBytes, expiresAt, now),
      // Queue jobs keep their per-scene outputs (for regenerating a scene or re-joining later).
      env.DB.prepare(`UPDATE render_jobs SET status = 'succeeded', history_id = ?, segment_urls = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(historyId, QUEUE_KINDS.has(row.kind) && manifest ? row.segmentUrls : JSON.stringify([source]), now, row.id, row.ownerId),
      env.DB.prepare(`UPDATE projects SET status = 'completed', final_history_id = ?, updated_at = ? WHERE render_job_id = ? AND owner_id = ?`).bind(historyId, now, row.id, row.ownerId),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'delivery', 'Your video is ready', 'The finished video is saved in your project history and ready to download.', NULL, ?)`).bind(`${historyId}:ready`, row.ownerId, now),
    ]);
    await sendAccountEmail(env, row.ownerId, "Your MotionWren video is ready", "Your finished video is saved in your MotionWren dashboard and ready to download.");
    // Scene photos and finished scenes are kept (regenerate a scene, re-join) until the retention clean-up.
  } catch (error) {
    await env.BUCKET.delete(r2Key);
    throw error;
  }
  return historyId;
}

export async function sendAccountEmail(env: { DB: D1Database }, ownerId: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FRAME_MOTION_FROM_EMAIL;
  if (!apiKey || !from) return;
  const user = await env.DB.prepare(`SELECT email FROM users WHERE id = ? LIMIT 1`).bind(ownerId).first<{ email: string }>();
  if (!user?.email) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [user.email], subject, text }),
    });
  } catch { /* Email failure must never fail the video delivery. */ }
}

export async function getRenderJob(env: { DB: D1Database }, id: string, ownerId?: string) {
  const ownerClause = ownerId ? " AND owner_id = ?" : "";
  const query = `SELECT id, owner_id AS ownerId, kind, status, prediction_ids AS predictionIds, segment_urls AS segmentUrls, stitch_prediction_id AS stitchPredictionId, prompt, category, resolution, aspect, duration, cost_cents AS costCents, error, history_id AS historyId, webhook_token AS webhookToken, created_at AS createdAt, updated_at AS updatedAt FROM render_jobs WHERE id = ?${ownerClause} LIMIT 1`;
  return ownerId ? env.DB.prepare(query).bind(id, ownerId).first<RenderJobRow>() : env.DB.prepare(query).bind(id).first<RenderJobRow>();
}

/* A customer's order is never left failed for the customer to see: a stopped
   order is quietly resumed by the heartbeat (up to MAX_RECOVERIES times, only
   the scenes that were not made are made again), and once those are used up
   the managers are alerted and the customer still sees it in production. */
/* Backups for a client order, in order: if the engine it started on cannot make a scene, the scenes still
   to be made go to the next one. Chosen for the same natural, photo-true look at a fair price. */
const BACKUP_ENGINES: StudioEngineKey[] = ["wan3", "hailuo23", "wan27", "kling3"];
const MAX_RECOVERIES = 3;
const HARD_ERROR = /not.?found|not supported|unavailable|invalid|unprocessable|HTTP 4(00|04|22)|safety|nsfw|moderat/i;
const WAIT_ERROR = /credit|throttl|rate limit|429|busy/i;
const recoveryKey = (id: string) => `job_recoveries:${id}`;

async function failRenderJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, message: string) {
  const now = Date.now();
  if (row.kind === "customer-series") {
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status NOT IN ('succeeded','failed')`).bind(message.slice(0, 1000), now, row.id).run();
    const used = Number((await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(recoveryKey(row.id)).first<{ value?: string }>())?.value || 0) || 0;
    if (used >= MAX_RECOVERIES) await alertManagers(env, "An order needs you", `A client order stopped even after ${MAX_RECOVERIES} automatic retries (${message.slice(0, 200)}). The customer has not been told. Open Production to resume or fix it.`);
    return;
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status NOT IN ('succeeded','failed')`).bind(message.slice(0, 1000), now, row.id),
    env.DB.prepare(`UPDATE projects SET status = 'failed', updated_at = ? WHERE render_job_id = ? AND owner_id = ? AND status != 'completed'`).bind(now, row.id, row.ownerId),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'generation_failed', 'Video processing stopped', ?, NULL, ?)`).bind(`${row.id}:failed`, row.ownerId, customerSafeError(message).slice(0, 500), now),
  ]);
  const project = await env.DB.prepare(`SELECT id FROM projects WHERE render_job_id = ? AND owner_id = ? LIMIT 1`).bind(row.id, row.ownerId).first<{ id: string }>();
  if (project) {
    const reserved = await env.DB.prepare(`SELECT id FROM credit_ledger WHERE project_id = ? AND owner_id = ? AND type = 'project_reservation' LIMIT 1`).bind(project.id, row.ownerId).first();
    if (reserved) {
      const refund = await env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, ?, ?, 1, 'automatic_refund', ?, 'Automatically returned after processing failure', ?)`).bind(crypto.randomUUID(), row.ownerId, project.id, row.id, `project:${project.id}:failure-refund`, now).run();
      if (refund.meta.changes) await env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + 1, updated_at = ? WHERE id = ?`).bind(now, row.ownerId).run();
    }
  }
  await sendAccountEmail(env, row.ownerId, "Your MotionWren project needs attention", `Video processing stopped: ${customerSafeError(message).slice(0, 500)}`);
}

/* Starts the queue for a job whose photos are all in: every scene waits its
   turn (scene-queue.ts). Scenes an older version already sent are kept. */
export async function beginQueue(env: { DB: D1Database; BUCKET: R2Bucket }, jobId: string, from: "starting" = "starting") {
  const manifest = await loadManifest(env, jobId);
  const row = await getRenderJob(env, jobId);
  if (!manifest || !row || row.status !== from) return false;
  const { ids, segments } = alignedScenes(row, manifest.inputs.length);
  const begun = await env.DB.prepare(`UPDATE render_jobs SET status = 'generating', prediction_ids = ?, segment_urls = ?, updated_at = ? WHERE id = ? AND status = ?`).bind(JSON.stringify(ids), JSON.stringify(segments), Date.now(), jobId, from).run();
  if (!begun.meta.changes) return false;
  await env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE render_job_id = ? AND status IN ('queued', 'submitted')`).bind(Date.now(), jobId).run();
  return true;
}

function queueHooks(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  return {
    lookup: replicatePrediction,
    cancel: cancelProviderJob,
    outputUrl,
    fail: async (message: string) => { const fresh = await getRenderJob(env, row.id); if (fresh) await failRenderJob(env, fresh, message); },
    assemble: async (segments: string[]) => {
      const fresh = await getRenderJob(env, row.id);
      if (!fresh || fresh.status !== "generating") return;
      const loadedManifest = segments.length === 1 ? await loadManifest(env, row.id) : null;
      const photoSingle = Boolean(loadedManifest && (loadedManifest.photoMoves?.some(Boolean) || loadedManifest.cards || loadedManifest.upscale));
      if (segments.length === 1 && !photoSingle) {
        const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
        if (!claim.meta.changes) return;
        const manifest = await loadManifest(env, row.id);
        if (manifest) { manifest.finalUrl = segments[0]; await saveManifest(env, row.id, manifest); }
        await saveFinishedJob(env, { ...fresh, status: "saving" }, segments[0]).catch(() => undefined); // stays "saving"; retried on the next step
        return;
      }
      const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'stitching', stitch_prediction_id = NULL, updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
      if (claim.meta.changes) await startJoin(env, { ...fresh, status: "stitching", stitchPredictionId: null }, token, webhookUrl);
    },
  };
}

/* Joins the finished scenes. Multi-scene films go to our composer (one music
   track, true crossfades, exact length); the engine-side joiner is the
   backup. A provider "slow down" here is a wait, not a failure: the job
   stays "joining" and the next step tries again. */
async function startJoin(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  const loaded = await loadManifest(env, row.id);
  const manifest = loaded ? normalizeManifest(loaded) : null;
  const origin = webhookUrl ? new URL(webhookUrl).origin : "";
  if (manifest && QUEUE_KINDS.has(row.kind) && (CROSSFADE_KINDS.has(row.kind) || manifest.photoMoves?.some(Boolean) || manifest.cards || manifest.upscale) && composerBinding(env) && !manifest.edit?.usedBackupJoiner && origin && row.webhookToken) {
    if (await startComposerEdit(env, row, manifest, origin)) return;
  }
  // A Photo-move film can only be edited by our editor: the backup joiner takes video clips, not photos.
  if (manifest?.photoMoves?.some(Boolean)) throw new Error(manifest.photoStrict && manifest.edit?.lastError ? manifest.edit.lastError : "The editing service could not take this film. It will be tried again.");
  // One carded clip: if the editor cannot take it, the plain clip is still delivered.
  if ((manifest?.cards || manifest?.upscale) && manifest.inputs.length === 1) {
    const single = alignedScenes(row, 1).segments[0];
    if (single) {
      manifest.finalUrl = single; await saveManifest(env, row.id, manifest);
      const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', updated_at = ? WHERE id = ? AND status = 'stitching'`).bind(Date.now(), row.id).run();
      if (claim.meta.changes) await saveFinishedJob(env, { ...row, status: "saving" }, single).catch(() => undefined);
      return;
    }
  }
  const provider = await readProviderState(env);
  if (provider.throttledUntil > Date.now() || provider.pausedUntil > Date.now()) return;
  let segments = JSON.parse(row.segmentUrls || "[]") as (string | null)[];
  if (manifest && QUEUE_KINDS.has(row.kind)) {
    segments = alignedScenes(row, manifest.inputs.length).segments;
    segments = stitchSources(manifest, segments as string[], webhookUrl ? new URL(webhookUrl).origin : "", row.id, row.webhookToken);
  }
  const urls = segments.filter((value): value is string => Boolean(value));
  if (urls.length < 2) throw new Error("The finished scenes could not be found for joining.");
  try {
    const stitchId = await startStitch(token, urls, row.resolution, row.aspect, CROSSFADE_KINDS.has(row.kind) ? 1 : 0, webhookUrl, row.duration, manifest?.audio);
    await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ? AND status = 'stitching'`).bind(stitchId, Date.now(), row.id).run();
  } catch (error) {
    if (error instanceof ProviderError && ["throttled", "credit", "transient"].includes(error.kind)) {
      const wait = Math.max(error.retryAfterMs, error.kind === "credit" ? 5 * 60 * 1000 : 10 * 1000);
      await writeProviderState(env, { lastError: error.message.slice(0, 300), lastErrorAt: Date.now(), ...(error.kind === "credit" ? { pausedUntil: Date.now() + wait, lowCredit: true } : { throttledUntil: Date.now() + wait }) });
      await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = NULL, updated_at = ? WHERE id = ?`).bind(Date.now(), row.id).run();
      return;
    }
    throw error;
  }
}

const EDIT_TRIES = 3;
const EDIT_TIME_LIMIT_MS = 30 * 60 * 1000;
const jobFileLink = (origin: string, row: RenderJobRow, file: string) => `${origin}/api/job-frames/${row.id}/${file}?token=${row.webhookToken}`;

/* Sends the film to our composer. Returns false when the editing service
   could not take it three times running, so the backup joiner takes over. */
async function startComposerEdit(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, manifest: Required<ProductionManifest>, origin: string) {
  const count = manifest.inputs.length;
  const { segments } = alignedScenes(row, count);
  const moves = segments.map((_, index) => manifest.photoMoves?.[index] || null);
  const clips = segments.map((url, index) => manifest.saved[index] && !moves[index] ? jobFileLink(origin, row, `out-${String(index + 1).padStart(2, "0")}.mp4`) : url);
  if ((count < 2 && !moves.some(Boolean) && !manifest.cards && !manifest.upscale) || clips.some((url) => !url)) throw new Error("The finished scenes could not be found for joining.");
  const edit = manifest.edit || {};
  const tries = (edit.tries || 0) + 1;
  const attempt = (edit.attempt || 0) + 1;
  const key = editKey(row.id, attempt);
  const crossfade = edit.crossfade ?? CROSSFADE_SECONDS;
  // Each scene's share on screen; older films (planned without overlap) fit what was made.
  const share = Math.min(manifest.sceneSeconds, edit.shareSeconds || (row.duration + (count - 1) * crossfade) / count);
  const duration = Math.round((count * share - (count - 1) * crossfade) * 1000) / 1000;
  // An upscaled film is edited at the engine's own 720p; the upscaler then makes the 1080p (stretching it first would waste it).
  const height = row.resolution === "1080p" && !manifest.upscale ? 1080 : row.resolution === "480p" ? 480 : 720;
  const wide = Math.round(height * 16 / 9 / 2) * 2;
  const [width, tall] = row.aspect === "vertical" ? [height, wide] : [wide, height];
  const music = count === 1 ? null : edit.music?.saved
    ? { url: jobFileLink(origin, row, "music.mp3") }
    : { prompt: edit.music?.prompt || musicPrompt({ aspect: row.aspect, duration: row.duration }), required: tries < EDIT_TRIES };
  manifest.edit = { ...edit, tries, attempt, key, startedAt: Date.now(), lastError: "" };
  try {
    await startEdit(env, row.id, key, { clips: clips as string[], width, height: tall, duration, sceneSeconds: share, crossfade, music, ...(moves.some(Boolean) ? { moves } : {}), ...(manifest.cards ? { cards: manifest.cards } : {}), ...(manifest.photoStrict ? { strictDepth: true } : {}), ...(manifest.photoMetric ? { depthMode: "metric" as const } : {}), ...(count === 1 && !moves.some(Boolean) ? { keepAudio: true } : {}), ...(await aiReviewOn(env) ? { stills: true } : {}) });
  } catch (error) {
    manifest.edit.key = undefined;
    manifest.edit.lastError = error instanceof Error ? error.message.slice(0, 300) : "The editing service did not answer.";
    await recordEditorState(env, { lastError: manifest.edit.lastError, lastErrorAt: Date.now() });
    if (tries >= EDIT_TRIES) manifest.edit.usedBackupJoiner = true;
    await saveManifest(env, row.id, manifest);
    if (tries >= EDIT_TRIES) { await alertManagers(env, "Film edited with the backup joiner", `The editing service could not take a film (${manifest.edit.lastError}). It was joined with the backup joiner, so its music changes between scenes. Use "Re-join scenes" once the editing service is back.`); return false; }
    return true; // tried again on the next step (the job stays "joining")
  }
  await saveManifest(env, row.id, manifest);
  await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ? AND status = 'stitching'`).bind(`composer:${key}`, Date.now(), row.id).run();
  return true;
}

/* Checks an edit in progress; when done, keeps the film's music and saves the film. */
async function checkComposerEdit(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  const key = String(row.stitchPredictionId).slice("composer:".length);
  const loaded = await loadManifest(env, row.id);
  if (!loaded) throw new Error("This video's settings were not saved.");
  const manifest = normalizeManifest(loaded);
  const edit = manifest.edit || {};
  let state: Awaited<ReturnType<typeof editState>> | null = null;
  try { state = await editState(env, row.id, key); }
  catch (error) { if (Date.now() - (edit.startedAt || 0) < EDIT_TIME_LIMIT_MS) return; state = { key, status: "failed", error: error instanceof Error ? error.message : "The editing service did not answer." }; }
  if (state.status === "running") {
    if (Date.now() - (edit.startedAt || 0) < EDIT_TIME_LIMIT_MS) return;
    state = { key, status: "failed", error: "The edit took too long." };
  }
  if (state.status === "unknown") state = { key, status: "failed", error: "The editing service restarted during the edit." };
  if (state.status === "failed") {
    manifest.edit = { ...edit, key: undefined, lastError: String(state.error || "The edit failed.").slice(0, 300) };
    await recordEditorState(env, { lastError: manifest.edit.lastError, lastErrorAt: Date.now() });
    if ((edit.tries || 0) >= EDIT_TRIES) manifest.edit.usedBackupJoiner = true;
    await saveManifest(env, row.id, manifest);
    const claim = await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = NULL, updated_at = ? WHERE id = ? AND stitch_prediction_id = ?`).bind(Date.now(), row.id, row.stitchPredictionId).run();
    if (manifest.edit.usedBackupJoiner) await alertManagers(env, "Film edited with the backup joiner", `A film's edit failed ${EDIT_TRIES} times (${manifest.edit.lastError}). It is being joined with the backup joiner, so its music changes between scenes. Use "Re-join scenes" to edit it again.`);
    if (claim.meta.changes) await startJoin(env, { ...row, stitchPredictionId: null }, token, webhookUrl);
    return;
  }
  // Done: claim it once, keep the music for later re-edits, then save the film.
  const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', updated_at = ? WHERE id = ? AND status = 'stitching' AND stitch_prediction_id = ?`).bind(Date.now(), row.id, row.stitchPredictionId).run();
  if (!claim.meta.changes) return;
  // A re-edit reuses the film's kept music, which says nothing about the music engines.
  const madeMusic = state.musicSource && state.musicSource !== "kept";
  await recordEditorState(env, { lastOkAt: Date.now(), ...(madeMusic ? { musicSource: state.musicSource, musicNote: state.musicError || "" } : {}) });
  if (state.music && !edit.music?.saved) {
    try {
      await storeResponse(env.BUCKET, musicKey(row.id), await editFile(env, row.id, key, "music"), "audio/mpeg");
      manifest.edit = { ...manifest.edit, music: { prompt: edit.music?.prompt || musicPrompt({ aspect: row.aspect, duration: row.duration }), saved: musicKey(row.id), source: state.musicSource } };
    } catch { /* the next edit simply makes music again */ }
  }
  manifest.finalUrl = `composer:${key}`;
  await saveManifest(env, row.id, manifest);
  await saveComposedFilm(env, { ...row, status: "saving" }, key, { token, origin: webhookUrl ? new URL(webhookUrl).origin : "" }).catch(() => undefined); // stays "saving"; retried on the next step
}

async function saveComposedFilm(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, key: string, ctx?: FinishContext) {
  // One save at a time (a callback and the heartbeat can arrive together).
  const lease = await acquireLease(env, `save-lock:${row.id}`, 3 * 60 * 1000);
  if (!lease) return null;
  try { return await collectComposedFilm(env, row, key, ctx); }
  finally { await releaseLease(env, `save-lock:${row.id}`, lease); }
}

type FinishContext = { token: string; origin: string };

const UPSCALE_ENDPOINT = "https://api.replicate.com/v1/models/topazlabs/video-upscale/predictions";
const UPSCALE_TRIES = 3;
const UPSCALE_TIME_LIMIT_MS = 40 * 60 * 1000;
const composedKey = (jobId: string) => `render-jobs/${jobId}/composed.mp4`;

/* Engines that make 720p: the edited film is upscaled to 1080p (Topaz) before
   it is saved. It never fails the order: on any trouble the 720p film is kept
   and the managers are told. Returns the film to save, or null to wait. */
async function upscaleFilm(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, manifest: ProductionManifest, film: Response | null, ctx: FinishContext): Promise<{ response: Response } | null> {
  const up = manifest.upscale!;
  const persist = () => saveManifest(env, row.id, manifest);
  const keep = async (why: string) => {
    up.done = true; up.skipped = why.slice(0, 300); await persist();
    await alertManagers(env, "A film was kept at 720p", `The 1080p upscale did not finish (${up.skipped}). The film was delivered at 720p.`);
    const stored = up.stored ? await env.BUCKET.get(composedKey(row.id)) : null;
    return { response: stored?.body ? new Response(stored.body, { headers: { "content-type": "video/mp4", "content-length": String(stored.size) } }) : film! };
  };
  if (!ctx.origin || !row.webhookToken) return keep("no link to give the upscaler");
  if (!up.stored) {
    if (!film) return null;
    await storeResponse(env.BUCKET, composedKey(row.id), film, "video/mp4");
    up.stored = true; up.startedAt = Date.now(); await persist();
    return null;
  }
  if (Date.now() - (up.startedAt || 0) > UPSCALE_TIME_LIMIT_MS) {
    if (up.predictionId) await cancelProviderJob(ctx.token, up.predictionId).catch(() => undefined);
    return keep(up.lastError || "it took too long");
  }
  if (!up.predictionId) {
    if ((up.tries || 0) >= UPSCALE_TRIES) return keep(up.lastError || "tried three times");
    const provider = await readProviderState(env);
    if (provider.throttledUntil > Date.now() || provider.pausedUntil > Date.now()) return null;
    try {
      up.predictionId = await createPrediction(ctx.token, UPSCALE_ENDPOINT, { video: jobFileLink(ctx.origin, row, "composed.mp4"), target_resolution: "1080p", target_fps: 30 });
      up.tries = (up.tries || 0) + 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The upscaler could not be reached.";
      up.lastError = message.slice(0, 200);
      if (!(error instanceof ProviderError && ["throttled", "credit", "transient"].includes(error.kind))) up.tries = (up.tries || 0) + 1;
    }
    await persist();
    return null;
  }
  let result: Record<string, unknown>;
  try { result = await replicatePrediction(ctx.token, up.predictionId); } catch { return null; }
  if (result.status === "failed" || result.status === "canceled") {
    up.lastError = String(result.error || "The upscale failed.").slice(0, 200); up.predictionId = undefined; await persist();
    return null;
  }
  if (result.status !== "succeeded") return null;
  const url = outputUrl(result.output);
  if (!url) { up.lastError = "The upscale finished without a video."; up.predictionId = undefined; await persist(); return null; }
  const download = await fetch(url);
  if (!download.ok) return null; // the file may not be ready to fetch yet: try again on the next step
  up.done = true; await persist();
  return { response: download };
}

/* The free quality check's verdict: kept with the order and, when it found
   something, the managers hear about it. Never blocks the film. */
async function recordFilmCheck(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, manifest: ProductionManifest, key: string, historyId: string | null) {
  try {
    const state = await editState(env, row.id, key);
    const qc = state.qc;
    if (state.stills) {
      const stills: Uint8Array[] = [];
      for (let n = 1; n <= state.stills; n += 1) stills.push(new Uint8Array(await (await editFile(env, row.id, key, `still/${n}` as `still/${number}`)).arrayBuffer()));
      const review = await reviewStills(env, stills);
      manifest.aiReview = review; await saveManifest(env, row.id, manifest);
      if (review.status === "flag") await alertManagers(env, "The AI review flagged a film", `${review.issues.join(" ")} Order ${row.id}${historyId ? `, film ${historyId}` : ""}. The film was still delivered; open it and decide whether to re-make it.`);
    }
    if (!qc || qc.status === "error") return;
    manifest.qc = qc; await saveManifest(env, row.id, manifest);
    if (qc.status !== "pass") {
      const what = qc.flags.map((flag) => flag.message).join(" ");
      await alertManagers(env, qc.status === "fail" ? "A film failed the quality check" : "A film has a quality warning", `${what} Order ${row.id}${historyId ? `, film ${historyId}` : ""}. The film was still delivered; open it and decide whether to re-make it.`);
    }
  } catch { /* the check is a bonus: never lose a film over it */ }
}

async function collectComposedFilm(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, key: string, ctx?: FinishContext) {
  const fresh = await getRenderJob(env, row.id);
  if (!fresh || fresh.historyId || fresh.status !== "saving") return fresh?.historyId || null;
  const loaded = QUEUE_KINDS.has(row.kind) ? await loadManifest(env, row.id) : null;
  const manifest = loaded ? normalizeManifest(loaded) : null;
  const upscaling = Boolean(manifest?.upscale && !manifest.upscale.done && ctx);
  let film: Response | null = null;
  if (!(upscaling && manifest!.upscale!.stored)) {
    try { film = await editFile(env, row.id, key, "output"); }
    catch (error) {
      // The container no longer has the film (restarted or asleep): edit it again.
      const state = await editState(env, row.id, key).catch(() => null);
      if (!state || state.status !== "done") {
        await env.DB.prepare(`UPDATE render_jobs SET status = 'stitching', stitch_prediction_id = NULL, updated_at = ? WHERE id = ? AND status = 'saving'`).bind(Date.now(), row.id).run();
        return null;
      }
      throw error;
    }
  }
  if (upscaling) {
    const out = await upscaleFilm(env, fresh, manifest!, film, ctx!);
    if (!out) return null;
    film = out.response;
  }
  const historyId = await storeFinishedFilm(env, fresh, film!, `composer:${key}`);
  if (manifest?.upscale?.stored) await env.BUCKET.delete(composedKey(row.id)).catch(() => undefined);
  if (manifest) await recordFilmCheck(env, row, manifest, key, historyId);
  await dropEdit(env, row.id, key);
  return historyId;
}

export async function advanceRenderJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  if (["succeeded", "failed"].includes(row.status)) return row;
  try {
    if (row.status === "starting" && Date.now() - row.updatedAt > 90 * 1000) {
      // The start was cut off (a refresh or dropped connection while the
      // photos were sent): carry on from where it was.
      const manifest = await loadManifest(env, row.id);
      if (!manifest) {
        if (Date.now() - row.updatedAt > 10 * 60 * 1000) throw new Error("The video could not start. Please try again.");
      } else {
        const present = row.kind.startsWith("studio-") ? await framesPresent(env, row.id, manifest.inputs.length) : [];
        if (present.some((value) => !value)) throw new Error("The photos did not finish sending, so nothing was made. Please start again.");
        if (await beginQueue(env, row.id)) {
          const fresh = await getRenderJob(env, row.id);
          if (fresh) await stepSceneQueue(env, row.id, token, webhookUrl, queueHooks(env, fresh, token, webhookUrl), () => getRenderJob(env, row.id));
        }
      }
    } else if (row.status === "generating" && QUEUE_KINDS.has(row.kind) && await loadManifest(env, row.id)) {
      await stepSceneQueue(env, row.id, token, webhookUrl, queueHooks(env, row, token, webhookUrl), () => getRenderJob(env, row.id));
    } else if (row.status === "generating") {
      // Frame transitions (made in one go, no scene queue).
      const ids = JSON.parse(row.predictionIds || "[]") as string[];
      const results = await Promise.all(ids.map(async (predictionId) => {
        try { return await replicatePrediction(token, predictionId); }
        catch (error) { return { status: "unknown", error: error instanceof Error ? error.message : "" } as Record<string, unknown>; }
      }));
      const failedResult = results.find((item) => item.status === "failed" || item.status === "canceled");
      if (failedResult) {
        await Promise.allSettled(ids.filter((id, index) => !["succeeded", "failed", "canceled"].includes(String(results[index].status))).map((id) => cancelProviderJob(token, id)));
        await failRenderJob(env, row, String(failedResult.error || "A transition did not finish."));
      } else {
        const urls = results.map((item) => item.status === "succeeded" ? outputUrl(item.output) : null).filter((value): value is string => Boolean(value));
        await env.DB.prepare(`UPDATE render_jobs SET segment_urls = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(urls), Date.now(), row.id).run();
        if (urls.length === ids.length && ids.length) {
          if (row.kind === "clean-transition" || urls.length === 1) {
            const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
            if (claim.meta.changes) await saveFinishedJob(env, { ...row, status: "saving", segmentUrls: JSON.stringify(urls) }, urls[0]).catch(() => undefined);
          } else {
            const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'stitching', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
            if (claim.meta.changes) await startJoin(env, { ...row, status: "stitching", segmentUrls: JSON.stringify(urls), stitchPredictionId: null }, token, webhookUrl);
          }
        }
      }
    } else if (row.status === "stitching" && !row.stitchPredictionId && Date.now() - row.updatedAt > 45 * 1000) {
      // Joining did not start (provider wait or a cut-off step): start it now.
      const claim = await env.DB.prepare(`UPDATE render_jobs SET updated_at = ? WHERE id = ? AND status = 'stitching' AND stitch_prediction_id IS NULL AND updated_at = ?`).bind(Date.now(), row.id, row.updatedAt).run();
      if (claim.meta.changes) await startJoin(env, row, token, webhookUrl);
    } else if (row.status === "stitching" && row.stitchPredictionId?.startsWith("composer:")) {
      await checkComposerEdit(env, row, token, webhookUrl);
    } else if (row.status === "stitching" && row.stitchPredictionId) {
      let stitch: Record<string, unknown>;
      try { stitch = await replicatePrediction(token, row.stitchPredictionId); }
      catch { return getRenderJob(env, row.id); } // lookup hiccup: check again on the next update
      if (stitch.status === "failed" || stitch.status === "canceled") {
        // Joining is tried three times with the same finished scenes before giving up.
        const manifest = await loadManifest(env, row.id);
        if (manifest && (manifest.stitchAttempts || 0) < 2) {
          manifest.stitchAttempts = (manifest.stitchAttempts || 0) + 1;
          await saveManifest(env, row.id, manifest);
          const claim = await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = NULL, updated_at = ? WHERE id = ? AND stitch_prediction_id = ?`).bind(Date.now(), row.id, row.stitchPredictionId).run();
          if (claim.meta.changes) await startJoin(env, { ...row, stitchPredictionId: null }, token, webhookUrl);
        } else {
          await failRenderJob(env, row, String(stitch.error || "Joining the scenes failed."));
        }
      } else if (stitch.status === "succeeded") {
        const finalUrl = outputUrl(stitch.output);
        if (!finalUrl) throw new Error("Joining finished without a usable video.");
        const queueJob = QUEUE_KINDS.has(row.kind);
        if (queueJob) { const manifest = await loadManifest(env, row.id); if (manifest) { manifest.finalUrl = finalUrl; await saveManifest(env, row.id, manifest); } }
        const segmentUrls = queueJob ? row.segmentUrls : JSON.stringify([finalUrl]);
        const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', segment_urls = ?, updated_at = ? WHERE id = ? AND status = 'stitching'`).bind(segmentUrls, Date.now(), row.id).run();
        if (claim.meta.changes) await saveFinishedJob(env, { ...row, status: "saving", segmentUrls }, finalUrl).catch(() => undefined); // retried while "saving"
      }
    } else if (row.status === "saving" && !row.historyId) {
      const manifest = QUEUE_KINDS.has(row.kind) ? await loadManifest(env, row.id) : null;
      const finalUrl = manifest?.finalUrl || (JSON.parse(row.segmentUrls || "[]") as string[])[0];
      if (!finalUrl) throw new Error("The finished video could not be recovered for storage.");
      if (finalUrl.startsWith("composer:")) { if (Date.now() - row.updatedAt > 20 * 1000) await saveComposedFilm(env, row, finalUrl.slice("composer:".length), { token, origin: webhookUrl ? new URL(webhookUrl).origin : "" }); return getRenderJob(env, row.id); }
      try { await saveFinishedJob(env, row, finalUrl); }
      catch (error) {
        // The engine keeps finished files for about an hour: keep trying to
        // store it until then, instead of failing on one slow download.
        if (Date.now() - row.updatedAt > 45 * 60 * 1000) throw error;
      }
    }
  } catch (error) {
    await failRenderJob(env, row, error instanceof Error ? error.message : "The video job could not be completed.");
  }
  return getRenderJob(env, row.id);
}

export function publicJob(row: RenderJobRow) {
  const predictionIds = JSON.parse(row.predictionIds || "[]") as string[];
  const segmentUrls = (JSON.parse(row.segmentUrls || "[]") as (string | null)[]).filter(Boolean);
  const total = QUEUE_KINDS.has(row.kind) ? Math.max(predictionIds.length, segmentUrls.length) : predictionIds.length;
  const completed = Math.min(total || segmentUrls.length, segmentUrls.length);
  const unit = CROSSFADE_KINDS.has(row.kind) || row.kind === "studio-single" ? (total === 1 ? "clip" : "scenes") : "transitions";
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.status === "generating" ? `${completed} of ${total} ${unit} ready` : row.status === "stitching" ? "Joining the scenes" : row.status === "saving" ? "Saving the finished video to History" : row.status === "succeeded" ? "Complete" : row.status === "failed" ? "Stopped" : "Starting",
    completed,
    total,
    error: row.error,
    historyId: row.historyId,
    videoUrl: row.historyId ? `/api/history/${row.historyId}/video` : null,
    downloadUrl: row.historyId ? `/api/history/${row.historyId}/video?download=1` : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    duration: row.duration,
    aspect: row.aspect,
    resolution: row.resolution,
    category: row.category,
    costCents: row.costCents,
  };
}

/* Per-scene detail for the progress views: state, why it is waiting, when it
   goes next, tries, last provider message and engine job ID (the last two
   are shown to the manager only). */
export async function jobScenes(env: { BUCKET: R2Bucket }, row: RenderJobRow) {
  const loaded = await loadManifest(env, row.id);
  if (!loaded) return null;
  const manifest = normalizeManifest(loaded);
  const finishing = ["stitching", "saving", "succeeded"].includes(row.status);
  const { ids } = alignedScenes(row, manifest.inputs.length);
  return manifest.states.map((state, index) => ({
    state: finishing ? "ready" : state === "waiting" ? "queued" : state === "retrying" ? "retry" : state,
    attempt: manifest.attempts[index] || 0,
    reason: finishing ? "" : manifest.reasons[index] || "",
    nextAt: manifest.nextAt[index] || 0,
    error: manifest.lastErrors[index] || "",
    predictionId: ids[index] && !ids[index].startsWith("pending-") && !ids[index].startsWith("resume-") ? ids[index] : "",
    saved: Boolean(manifest.saved[index]),
    // A stopped video's finished scene whose engine copy has expired and was never kept: Resume makes it again.
    expired: row.status === "failed" && (finishing ? false : state === "ready") && !manifest.saved[index] && Date.now() - (manifest.readyAt[index] || 0) > 45 * 60 * 1000,
  }));
}

/* What the provider is doing right now, for the progress views. */
export async function providerNote(env: { DB: D1Database }) {
  const state = await readProviderState(env);
  const now = Date.now();
  return {
    waitingUntil: Math.max(state.throttledUntil, state.pausedUntil) > now ? Math.max(state.throttledUntil, state.pausedUntil) : 0,
    paused: state.pausedUntil > now,
    lowCredit: state.lowCredit,
  };
}

/* Moves along jobs whose provider callbacks may have been missed. Called by
   pages that show production (customer dashboard, manager, Studio) so a
   lost webhook can never leave a video stuck. */
/* Moves along videos nothing has touched for 45 s, oldest first (so the
   earliest orders finish first). The heartbeat passes a larger limit and a
   time budget so every waiting video is reached each minute, a few at a time. */
/* Quietly resumes stopped client orders (see failRenderJob). Run by the heartbeat. */
export async function recoverFailedOrders(env: { DB: D1Database; BUCKET: R2Bucket }) {
  const now = Date.now();
  const stopped = await env.DB.prepare(`SELECT j.id FROM render_jobs j WHERE j.kind = 'customer-series' AND j.status = 'failed' AND j.updated_at < ? AND j.updated_at > ? AND COALESCE(j.error, '') NOT LIKE 'Stopped%' AND COALESCE((SELECT CAST(value AS INTEGER) FROM platform_settings WHERE key = 'job_recoveries:' || j.id), 0) < ? ORDER BY j.updated_at ASC LIMIT 2`).bind(now - 90 * 1000, now - 6 * 60 * 60 * 1000, MAX_RECOVERIES).all<{ id: string }>();
  for (const item of stopped.results) {
    const row = await getRenderJob(env, item.id);
    if (!row) continue;
    const used = Number((await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(recoveryKey(row.id)).first<{ value?: string }>())?.value || 0) || 0;
    await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(recoveryKey(row.id), String(used + 1), now).run();
    // Find why, then fix it: waiting problems just resume; an engine-side problem (or a second stop) moves the
    // scenes still to be made to the next backup engine.
    const manifest = await loadManifest(env, row.id).catch(() => null);
    const current = (manifest?.engine || "wan3") as StudioEngineKey;
    const at = BACKUP_ENGINES.indexOf(current);
    const next = BACKUP_ENGINES.slice(at + 1).find((engine) => !studioEngine(engine).unavailable);
    const reason = String(row.error || "");
    const changeEngine = Boolean(next) && !WAIT_ERROR.test(reason) && (HARD_ERROR.test(reason) || used >= 1);
    const done = await applyJobAction(env, row, "resume", null, changeEngine ? next : undefined).catch(() => ({ error: "failed" }));
    if (changeEngine && "ok" in done) await alertManagers(env, "Order moved to a backup engine", `An order's scenes could not be made by ${studioEngine(current).name} (${reason.slice(0, 160)}). The scenes still to be made went to ${studioEngine(next!).name}. The customer was not told.`);
  }
}

export async function advanceStaleJobs(env: { DB: D1Database; BUCKET: R2Bucket }, origin: string, ownerId: string | null, limit = 3, { parallel = 1, budgetMs = 0 } = {}) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return 0;
  if (!ownerId) await recoverFailedOrders(env).catch(() => undefined);
  const query = `SELECT id FROM render_jobs WHERE status IN ('starting','generating','stitching','saving') AND updated_at < ?${ownerId ? " AND owner_id = ?" : ""} ORDER BY created_at ASC LIMIT ?`;
  const cutoff = Date.now() - 45 * 1000;
  const stale = ownerId
    ? await env.DB.prepare(query).bind(cutoff, ownerId, limit).all<{ id: string }>()
    : await env.DB.prepare(query).bind(cutoff, limit).all<{ id: string }>();
  const startedAt = Date.now();
  const waiting = [...stale.results];
  let moved = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, waiting.length)) }, async () => {
    while (waiting.length && (!budgetMs || Date.now() - startedAt < budgetMs)) {
      const item = waiting.shift()!;
      const row = await getRenderJob(env, item.id);
      if (!row || !row.webhookToken) continue;
      await advanceRenderJob(env, row, token, `${origin}/api/webhooks/replicate/${row.id}?token=${row.webhookToken}`).catch(() => undefined);
      moved += 1;
    }
  }));
  return moved;
}

/* Manager/owner actions on a video (resume, retry or regenerate a scene,
   re-join). The queue does the work, with its usual protections; this only
   marks what to make and gives the queue a first step. */
export async function runJobAction(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, action: JobAction, scene: number | null, token: string, webhookUrl?: string) {
  const result = await applyJobAction(env, row, action, scene);
  if ("error" in result) return result;
  const fresh = await getRenderJob(env, row.id);
  if (fresh) await advanceRenderJob(env, fresh, token, webhookUrl);
  return result;
}

/* "Start over": a brand-new run with the same photos and settings; the old
   one is stopped (anything still with the engine is cancelled). Clients'
   orders keep pointing at the new run. */
export async function startOverJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, origin: string) {
  const loaded = await loadManifest(env, row.id);
  if (!loaded) return { error: "This video was made before it could be run again. Please start a new one." };
  const manifest = normalizeManifest(loaded);
  const count = manifest.inputs.length;
  const id = crypto.randomUUID();
  const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const now = Date.now();
  const studio = row.kind.startsWith("studio-");
  const photos = (manifest.photos || []).map((photo, index) => studio
    ? { key: frameKey(id, index), link: `${origin}/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg?token=${webhookToken}` }
    : { key: photo.key, link: photo.link });
  if (studio) {
    for (let index = 0; index < count; index += 1) {
      const object = await env.BUCKET.get(frameKey(row.id, index));
      if (!object) return { error: "This video's photos are no longer stored. Please start a new one." };
      await env.BUCKET.put(frameKey(id, index), await new Response(object.body).arrayBuffer(), { httpMetadata: { contentType: object.httpMetadata?.contentType || "image/jpeg" } });
    }
  }
  const inputs = manifest.inputs.map((input, index) => {
    const before = manifest.photos?.[index]?.link;
    const after = photos[index]?.link;
    return before && after ? Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === before ? after : value])) : input;
  });
  const fresh = newManifest(manifest.engine, manifest.endpoint, manifest.sceneSeconds, inputs, manifest.audio, photos.length ? photos : undefined);
  // Same plan and music style; the new run gets its own edit and music.
  if (manifest.edit) fresh.edit = { shareSeconds: manifest.edit.shareSeconds, crossfade: manifest.edit.crossfade, ...(manifest.edit.music ? { music: { prompt: manifest.edit.music.prompt } } : {}) };
  await saveManifest(env, id, fresh);
  await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, ?, 'generating', ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
    .bind(id, row.ownerId, row.kind, JSON.stringify(Array.from({ length: count }, () => "")), JSON.stringify(Array.from({ length: count }, () => null)), row.prompt, row.category, row.resolution, row.aspect, row.duration, row.costCents, webhookToken, now, now).run();
  // Stop the old run (nothing it already finished is charged again).
  if (!["succeeded", "failed"].includes(row.status)) {
    const ids = [...(JSON.parse(row.predictionIds || "[]") as string[]), ...(row.stitchPredictionId ? [row.stitchPredictionId] : [])];
    await Promise.allSettled(ids.filter(Boolean).map((predictionId) => cancelProviderJob(token, predictionId)));
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = 'Replaced by a new run.', updated_at = ? WHERE id = ?`).bind(now, row.id).run();
  }
  await env.DB.prepare(`UPDATE projects SET render_job_id = ?, status = 'generating', updated_at = ? WHERE render_job_id = ?`).bind(id, now, row.id).run();
  const job = await getRenderJob(env, id);
  if (job) await advanceRenderJob(env, job, token, `${origin}/api/webhooks/replicate/${id}?token=${webhookToken}`);
  return { id };
}
