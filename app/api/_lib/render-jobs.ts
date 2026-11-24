import { getChatGPTUser } from "../../chatgpt-auth";
import { cookies } from "next/headers";
import { customerSafeError } from "./customer-errors";
import { HttpError, audit } from "./account";
import { MAX_FIX_ROUNDS, SIDEWAYS_SPEED, cleanCards, isSidewaysMove, frameKey, framesPresent, loadManifest, musicKey, newManifest, normalizeManifest, outputKey, queuedPhotoKey, saveManifest, type ProductionManifest, type QueuedEdit } from "./production";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution } from "../../engine-providers";
import { REALITY_SOURCE_MAX_BYTES, aiReviewOn, reviewSettings, reviewStills } from "./film-review";
import { soundLayers } from "./film-sound";
import { ElevenLabsMissingKey, makeCutEffects, makeSfx, makeVoice } from "./film-sound";
import { addTrack, markUsed, pickTrack, styleOfPrompt, trackAudio } from "./music-library";
import { ENGINE_ORDER } from "../../engine-order";
import { isEngineVideoHost } from "./engine-hosts";
import { composerBinding, dropEdit, editFile, editKey, editState, musicPrompt, recordEditorState, startEdit, storeResponse } from "./composer";
import { CROSSFADE_SECONDS, PHOTO_MOVE_KEYS, UPSCALE_PER_SECOND, engineCost, engineUpscales, filmSceneDurations, nativeResolution, studioEngine, type StudioEngineKey } from "../../engine-catalog";
import { AUTO_FIX_ROUNDS, autoRemake, fixEngine } from "../../fix-engine";
import { fixInstruction } from "../../fix-notes";
import { motionLabel } from "../../motion-label";
import { videoRef } from "../../video-ref";
import { isWrenId, joinTimes, recipeSeconds } from "../../wrencut";
import { getRecipe, recipeFor } from "./wrencut";
import { cleanFilmTitles } from "../../titles";
import { musicTemplate } from "../../music-catalog";
import { shapeSize } from "../../original-shape";
import { guardCheck } from "./spend-guard";
import { acquireLease, classify, createPrediction, ProviderError, providerUrl, readProviderState, releaseLease, writeProviderState } from "./provider";
import { QUEUE_KINDS, alertManagers, alignedScenes, applyJobAction, stepSceneQueue, stitchSources, type JobAction } from "./scene-queue";

/* Kinds whose scenes are joined with one-second cross-dissolves. */
const CROSSFADE_KINDS = new Set(["customer-series", "studio-series", "ad-series"]);
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
    return url.protocol === "https:" && (isEngineVideoHost(url.hostname) || Boolean(compositorHost && url.hostname === compositorHost)) ? url.toString() : null;
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

/* Stops an engine job and checks that it really stopped (a cancel that is accepted but ignored kept a stopped film running, and paid for, at the engine). */
export async function cancelAndConfirm(token: string, id: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await cancelProviderJob(token, id).catch(() => undefined);
    const state = await replicatePrediction(token, id).catch(() => null);
    if (!state || ["canceled", "failed", "succeeded"].includes(String(state.status))) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
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
  if (aspect === "square") return { width: height, height };
  if (aspect === "portrait") return { width: height, height: Math.round(height * 5 / 4 / 2) * 2 };
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
  // History names the engine the video was made with: the one that was chosen. A quality re-make can move a scene to
  // another engine (manifest.engine then names that one), so the chosen engine is kept in startedEngine (older films: fix.firstEngine).
  const engine = manifest?.startedEngine || manifest?.fix?.firstEngine || manifest?.engine || KIND_ENGINE[row.kind] || "studio";
  const r2Key = `generation-history/${row.ownerId}/${historyId}.mp4`;
  // A response with a known size streams straight into storage; one without
  // (chunked) is read in full first, since storage needs the size up front.
  await storeResponse(env.BUCKET, r2Key, upstream, contentType === "application/octet-stream" ? "video/mp4" : contentType);
  try {
    const now = Date.now();
    const expiresAt = now + 90 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(historyId, row.ownerId, r2Key, row.prompt, engine, row.category, row.resolution, manifest?.edit?.reframe || row.aspect, row.duration, row.costCents, sizeBytes, expiresAt, now),
      // Queue jobs keep their per-scene outputs (for regenerating a scene or re-joining later).
      env.DB.prepare(`UPDATE render_jobs SET status = 'succeeded', history_id = ?, segment_urls = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(historyId, QUEUE_KINDS.has(row.kind) && manifest ? row.segmentUrls : JSON.stringify([source]), now, row.id, row.ownerId),
      env.DB.prepare(`UPDATE projects SET status = 'completed', final_history_id = ?, updated_at = ? WHERE render_job_id = ? AND owner_id = ?`).bind(historyId, now, row.id, row.ownerId),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'delivery', 'Your video is ready', 'The finished video is saved in your project history and ready to download.', NULL, ?)`).bind(`${historyId}:ready`, row.ownerId, now),
    ]);
    // A later version: remember it in order, so History can list the first version as the original and the edits after it.
    if (existing && manifest) { manifest.versions = [...(manifest.versions || []), historyId]; await saveManifest(env, row.id, manifest).catch(() => undefined); }
    // One "ready" email per finished video, even if this step runs twice.
    const first = await env.DB.prepare(`INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES (?1, '1', ?2)`).bind(`ready-email:${historyId}`, Date.now()).run().catch(() => null);
    if (first?.meta?.changes) await sendAccountEmail(env, row.ownerId, "Your MotionWren video is ready", READY_TEXT, readyEmailHtml());
    // Scene photos and finished scenes are kept (regenerate a scene, re-join) until the retention clean-up.
  } catch (error) {
    await env.BUCKET.delete(r2Key);
    throw error;
  }
  return historyId;
}

const DASHBOARD_URL = "https://motionwren.com/dashboard";
const READY_TEXT = `Your video is ready.\n\nWatch it and download it here:\n${DASHBOARD_URL}\n\nIt stays saved in your dashboard for 90 days.\n\nMotionWren`;
/* Plain, spacious and short: one message and one button. */
export function readyEmailHtml() {
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:440px;margin:0 auto;padding:48px 24px;color:#1a1a1a"><p style="font-size:22px;font-weight:600;margin:0 0 12px">Your video is ready.</p><p style="font-size:15px;line-height:1.5;color:#555;margin:0 0 28px">Watch it and download it from your dashboard. It stays saved there for 90 days.</p><a href="${DASHBOARD_URL}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-size:15px;padding:12px 22px;border-radius:999px">Watch your video</a><p style="font-size:12px;color:#999;margin:36px 0 0">MotionWren</p></div>`;
}

export async function sendAccountEmail(env: { DB: D1Database }, ownerId: string, subject: string, text: string, html?: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FRAME_MOTION_FROM_EMAIL;
  if (!apiKey || !from) return;
  const user = await env.DB.prepare(`SELECT email FROM users WHERE id = ? LIMIT 1`).bind(ownerId).first<{ email: string }>();
  if (!user?.email) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [user.email], subject, text, ...(html ? { html } : {}) }),
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
   the managers are alerted and the customer is told it is taking longer
   (see HOLDING_MESSAGE) — never that it failed. The fix itself stays with
   the heartbeat and the managers; the customer can ask for their credit
   back, but only as a fallback (see refundHoldingOrder). */
/* Backups for a client order, in order (see ENGINE_ORDER): if the engine it started on cannot make a scene, the scenes still
   to be made go to the next one. */
const BACKUP_ENGINES = ENGINE_ORDER;
const MAX_RECOVERIES = 3;
const HARD_ERROR = /not.?found|not supported|unavailable|invalid|unprocessable|HTTP 4(00|04|22)|safety|nsfw|moderat/i;
const WAIT_ERROR = /credit|throttl|rate limit|429|busy/i;
const recoveryKey = (id: string) => `job_recoveries:${id}`;

/* A stopped customer order is "holding" once the automatic retries are used
   up, or once it has sat failed past the heartbeat's recovery window: the
   fix is no longer quick, so the customer is told it is taking longer.
   Jobs the customer stopped themselves (or got refunded) are never holding. */
export const HOLDING_WINDOW_MS = 6 * 60 * 60 * 1000;
export const HOLDING_MESSAGE = "We're looking into this — your video is taking a little longer than usual. This can happen with a technical issue or a high volume of submissions. We're on it and we'll get back to you as soon as it's ready.";
export function isHoldingJob(job: { status: string; updatedAt: number; error?: string | null } | null, recoveries: number, now = Date.now()): boolean {
  if (!job || job.status !== "failed") return false;
  if (String(job.error || "").startsWith("Stopped")) return false;
  return recoveries >= MAX_RECOVERIES || now - job.updatedAt > HOLDING_WINDOW_MS;
}
export async function getRecoveries(env: { DB: D1Database }, jobId: string): Promise<number> {
  return Number((await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(recoveryKey(jobId)).first<{ value?: string }>())?.value || 0) || 0;
}

export async function failRenderJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, message: string) {
  const now = Date.now();
  if (row.kind === "customer-series") {
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status NOT IN ('succeeded','failed')`).bind(message.slice(0, 1000), now, row.id).run();
    const used = await getRecoveries(env, row.id);
    if (used >= MAX_RECOVERIES) {
      await alertManagers(env, "An order needs you", `A client order stopped even after ${MAX_RECOVERIES} automatic retries (${message.slice(0, 200)}). The customer has been told it is taking longer. Open Production to resume or fix it.`);
      // The holding message, once per order: the customer is told it is
      // taking longer — never that it failed — and can ask for a refund.
      const note = await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'production_delayed', 'Taking a little longer', ?, NULL, ?)`).bind(`${row.id}:delayed`, row.ownerId, HOLDING_MESSAGE, now).run();
      if (note.meta.changes) await sendAccountEmail(env, row.ownerId, "Your MotionWren video is taking a little longer", HOLDING_MESSAGE);
    }
    return;
  }
  const failed = await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status NOT IN ('succeeded','failed')`).bind(message.slice(0, 1000), now, row.id),
    env.DB.prepare(`UPDATE projects SET status = 'failed', updated_at = ? WHERE render_job_id = ? AND owner_id = ? AND status != 'completed'`).bind(now, row.id, row.ownerId),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'generation_failed', 'Video processing stopped', ?, NULL, ?)`).bind(`${row.id}:failed`, row.ownerId, customerSafeError(message).slice(0, 500), now),
  ]);
  // Photos that never arrived: the owner is told by email too, in case they left the page and are not looking at it.
  if (failed[0]?.meta?.changes && row.kind.startsWith("studio-") && /did not finish sending/i.test(message)) await sendAccountEmail(env, row.ownerId, "Your film was not started: its photos did not arrive", `${message}\n\nOpen MotionWren Studio on the phone you sent them from and choose Send again, or start the film again. Nothing was charged.`);
  const project = await env.DB.prepare(`SELECT id FROM projects WHERE render_job_id = ? AND owner_id = ? LIMIT 1`).bind(row.id, row.ownerId).first<{ id: string }>();
  if (project) {
    const reserved = await env.DB.prepare(`SELECT id FROM credit_ledger WHERE project_id = ? AND owner_id = ? AND type = 'project_reservation' LIMIT 1`).bind(project.id, row.ownerId).first();
    if (reserved) {
      // One transaction: the ledger row and the balance move together. changes() is 1 only when the keyed ledger row was really inserted, so a repeat ask never returns a second credit.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, ?, ?, 1, 'automatic_refund', ?, 'Returned after the customer asked for a refund on a delayed order', ?)`).bind(crypto.randomUUID(), ownerId, project.id, job.id, `project:${project.id}:failure-refund`, now),
    env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + 1, updated_at = ? WHERE id = ? AND changes() = 1`).bind(now, ownerId),
  ]);
    }
  }
  await sendAccountEmail(env, row.ownerId, "Your MotionWren project needs attention", `Video processing stopped: ${customerSafeError(message).slice(0, 500)}`);
}

/* A customer asks for their credit back on a holding order: the order is
   past the automatic retries, so the fix did not land quickly. The refund
   is the fallback, not the first thing shown — it only runs on an order the
   customer already sees as taking longer, and only when a credit was
   actually reserved for it. Idempotent: a second ask finds the order
   cancelled and is refused, and the ledger insert is keyed so a credit can
   never be returned twice for one order. */
export async function refundHoldingOrder(env: { DB: D1Database }, projectId: string, ownerId: string) {
  const now = Date.now();
  const project = await env.DB.prepare(`SELECT id, render_job_id AS renderJobId FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(projectId, ownerId).first<{ id: string; renderJobId: string | null }>();
  if (!project) throw new HttpError(404, "Project not found.");
  if (!project.renderJobId) throw new HttpError(409, "This order has no video to refund.");
  const job = await getRenderJob(env, project.renderJobId, ownerId);
  if (!job) throw new HttpError(409, "This order has no video to refund.");
  if (job.status !== "failed") throw new HttpError(409, "This order is still being worked on.");
  if (!isHoldingJob(job, await getRecoveries(env, job.id), now)) throw new HttpError(409, "This order is not waiting on a fix yet.");
  const reserved = await env.DB.prepare(`SELECT id FROM credit_ledger WHERE project_id = ? AND owner_id = ? AND type = 'project_reservation' LIMIT 1`).bind(project.id, ownerId).first();
  if (!reserved) throw new HttpError(409, "There's no credit to refund for this order.");
  const refund = await env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, ?, ?, 1, 'automatic_refund', ?, 'Returned after the customer asked for a refund on a delayed order', ?)`).bind(crypto.randomUUID(), ownerId, project.id, job.id, `project:${project.id}:failure-refund`, now).run();
  if (refund.meta.changes) await env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + 1, updated_at = ? WHERE id = ?`).bind(now, ownerId).run();
  await env.DB.batch([
    env.DB.prepare(`UPDATE projects SET status = 'cancelled', updated_at = ? WHERE id = ? AND owner_id = ? AND status != 'completed'`).bind(now, project.id, ownerId),
    // Stopped jobs are skipped by the heartbeat's recovery, so a refunded
    // order is never quietly resumed (and re-spent) afterwards.
    env.DB.prepare(`UPDATE render_jobs SET error = 'Stopped by customer refund.', updated_at = ? WHERE id = ? AND status = 'failed'`).bind(now, job.id),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'refund_issued', 'Refund issued', 'One video credit was returned to your account.', NULL, ?)`).bind(`${project.id}:refunded`, ownerId, now),
  ]);
  await audit(env, ownerId, "project.refunded", "project", project.id);
  const balance = await env.DB.prepare(`SELECT credit_balance AS creditBalance FROM users WHERE id = ? LIMIT 1`).bind(ownerId).first<{ creditBalance: number }>();
  return { refunded: true, creditBalance: balance?.creditBalance ?? 0 };
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
      // A single clip is saved as-is — unless it still needs the composer: a photo move, cards, an upscale, a slow single, or a frame cut.
      const singleNeedsComposer = Boolean(loadedManifest && (loadedManifest.photoMoves?.some(Boolean) || loadedManifest.cards || loadedManifest.upscale || slowSingle(loadedManifest) || loadedManifest.edit?.reframe));
      if (segments.length === 1 && !singleNeedsComposer && !loadedManifest?.ads) {
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
  if (manifest && QUEUE_KINDS.has(row.kind) && (CROSSFADE_KINDS.has(row.kind) || manifest.photoMoves?.some(Boolean) || manifest.cards || manifest.upscale || slowSingle(manifest) || manifest.edit?.sound?.voice || manifest.edit?.sound?.sfx || manifest.edit?.reframe) && composerBinding(env) && !manifest.edit?.usedBackupJoiner && origin && row.webhookToken) {
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
    const stitchId = await startStitch(token, urls, row.resolution, manifest?.edit?.reframe || row.aspect, CROSSFADE_KINDS.has(row.kind) ? 1 : 0, webhookUrl, row.duration, manifest?.audio);
    await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ? AND status = 'stitching'`).bind(stitchId, Date.now(), row.id).run();
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "budget") {
      await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = NULL, updated_at = ? WHERE id = ?`).bind(Date.now(), row.id).run(); // held by the spending guard: tried again by the next step
      return;
    }
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
/* One scene that orbits or pans is also played slower in the edit. */
const slowSingle = (manifest: ProductionManifest) => manifest.inputs.length === 1 && !manifest.photoMoves?.[0] && isSidewaysMove(manifest.inputs[0]?.prompt);

/* A template recipe's length: its scenes end to end, less the overlap of
   each true dissolve (spec v1 — the same arithmetic as the composer's
   templateDuration, which is the authority; this only sizes the job). */
const templateRecipeSeconds = (recipe: { scenes?: { duration_s?: number; transition_in?: string }[] }) => {
  const scenes = recipe?.scenes ?? [];
  const overlap = scenes.filter((s) => s.transition_in === "crossfade").length * CROSSFADE_SECONDS;
  return Math.round((scenes.reduce((sum, s) => sum + (s.duration_s || 0), 0) - overlap) * 1000) / 1000;
};

async function startComposerEdit(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, manifest: Required<ProductionManifest>, origin: string) {
  const count = manifest.inputs.length;
  const { segments } = alignedScenes(row, count);
  const allMoves = segments.map((_, index) => manifest.photoMoves?.[index] || null);
  const allSpeeds = segments.map((_, index) => !allMoves[index] && isSidewaysMove(manifest.inputs[index]?.prompt) ? SIDEWAYS_SPEED : 1);
  const allClips = segments.map((url, index) => manifest.saved[index] && !allMoves[index] ? jobFileLink(origin, row, `out-${String(index + 1).padStart(2, "0")}.mp4`) : url);
  // A template film can be edited from only some of its clips (chosen when it is edited again).
  const only = manifest.edit?.recipe && manifest.edit.useScenes?.length ? [...new Set(manifest.edit.useScenes)].filter((index) => Number.isInteger(index) && index >= 0 && index < count) : [];
  const pick = <T,>(list: T[]) => only.length >= 2 ? only.map((index) => list[index]) : list;
  const moves = pick(allMoves), speeds = pick(allSpeeds), clips = pick(allClips);
  if ((count < 2 && !manifest.ads && !moves.some(Boolean) && !manifest.cards && !manifest.upscale && !slowSingle(manifest) && !manifest.edit?.sound?.voice && !manifest.edit?.sound?.sfx && !manifest.edit?.reframe) || clips.some((url) => !url)) throw new Error("The finished scenes could not be found for joining.");
  let edit = manifest.edit || {};
  const tries = (edit.tries || 0) + 1;
  const attempt = (edit.attempt || 0) + 1;
  const key = editKey(row.id, attempt);
  const crossfade = edit.crossfade ?? CROSSFADE_SECONDS;
  // Each scene's share on screen; older films (planned without overlap) fit what was made.
  const share = Math.min(manifest.sceneSeconds, edit.shareSeconds || (row.duration + (count - 1) * crossfade) / count);
  const duration = manifest.edit?.templateRecipe ? templateRecipeSeconds(manifest.edit.templateRecipe)
    : manifest.edit?.recipe ? recipeSeconds(manifest.edit.recipe)
    : Math.round((count * share - (count - 1) * crossfade) * 1000) / 1000;
  // An upscaled film is edited at the engine's own 720p; the upscaler then makes the 1080p (stretching it first would waste it).
  // A template recipe film is the exception: the composer renders it at the recipe's own resolution and refuses any other
  // size, so the edit height comes from the recipe — an upscale flag on the manifest must never drop it to 720p.
  const recipeHeight = (() => { const parts = String(manifest.edit?.templateRecipe?.resolution || "").split("x").map(Number); return parts.length === 2 && parts.every((n) => Number.isFinite(n) && n >= 240 && n <= 4320) ? parts[1] : null; })();
  const height = recipeHeight ?? (row.resolution === "1080p" && !manifest.upscale ? 1080 : row.resolution === "480p" ? 480 : 720);
  const wide = Math.round(height * 16 / 9 / 2) * 2;
  // The frame the film is saved at: the one it was cut to in Edit, else the one it was made at. A film made at the photo's own
  // shape is edited at that shape. A cut keeps the floor when height has to go (see anchorY).
  const cut = manifest.edit?.reframe;
  const own = !cut && row.aspect === "original" && manifest.frame?.ratio ? shapeSize(manifest.frame.ratio, height) : null;
  const frameNow = cut || row.aspect;
  const [width, tall] = own ? [own.width, own.height] : frameNow === "vertical" ? [height, wide] : frameNow === "square" ? [height, height] : frameNow === "portrait" ? [height, Math.round(height * 5 / 4 / 2) * 2] : [wide, height];
  // Studio Ads with the ElevenLabs toggle off arrive with no edit.music:
  // no generated music — the scenes keep their own sound (keepAudio below).
  // Never fall through to the customer musicPrompt fallback here.
  const adNoSound = manifest.ads && !edit.music;
  let musicChoice: { url: string } | null = null;
  const music = adNoSound ? null
    : count === 1 && !manifest.ads ? null
    : edit.sound?.noMusic ? null
    : edit.music?.saved
      ? { url: jobFileLink(origin, row, "music.mp3") }
      : { prompt: edit.music?.prompt || musicPrompt({ aspect: row.aspect, duration: row.duration }), required: tries < EDIT_TRIES };
  // A style with enough kept tracks takes the least-used one instead of paying for a new track.
  if (music && "prompt" in music && !edit.music?.saved && count > 1 && !manifest.ads) {
    try {
      const track = await pickTrack(env, styleOfPrompt(music.prompt), duration + 0.5);
      const audio = track ? await trackAudio(env, track.id) : null;
      if (track && audio) {
        await storeResponse(env.BUCKET, musicKey(row.id), new Response(audio.body), "audio/mpeg");
        await markUsed(env, track.id);
        edit = { ...edit, music: { prompt: music.prompt, saved: musicKey(row.id), source: "library", libraryId: track.id } };
        musicChoice = { url: jobFileLink(origin, row, "music.mp3") };
      }
    } catch { /* the library is a saving, never a requirement: make new music instead */ }
  }
  const layers = soundLayers(edit.sound, (file) => jobFileLink(origin, row, file), share, crossfade, duration);
  manifest.edit = { ...edit, tries, attempt, key, startedAt: Date.now(), lastError: "", ...(edit.music && !edit.music.saved ? { music: { ...edit.music, seconds: duration } } : {}) };
  try {
    await startEdit(env, row.id, key, { clips: clips as string[], width, height: tall, ...(cut ? { anchorY: 0.75 } : {}), duration, sceneSeconds: share, crossfade, music: musicChoice || music, ...(layers.length ? { layers } : {}), ...(moves.some(Boolean) ? { moves } : {}), ...(speeds.some((value) => value < 1) ? { speeds } : {}), ...(manifest.cards ? { cards: manifest.cards } : {}), ...(manifest.edit?.titles ? { titles: manifest.edit.titles } : {}), ...(manifest.photoStrict ? { strictDepth: true } : {}), ...(manifest.photoMetric ? { depthMode: "metric" as const } : {}), ...(manifest.photoHybrid ? { hybrid: true } : {}), ...(count === 1 && !manifest.ads && !moves.some(Boolean) ? { keepAudio: true } : {}), ...(manifest.ads && !edit.music && !edit.voiceover ? { keepAudio: true } : {}), ...(!manifest.ads && (await aiReviewOn(env)) ? { stills: Math.min(24, Math.max(4, (clips as string[]).length * 3)) } : {}), ...(manifest.edit?.subtitles?.lines?.length ? { subtitles: manifest.edit.subtitles } : {}), ...(manifest.edit?.grade ? { grade: manifest.edit.grade } : {}), ...(manifest.edit?.recipe ? { recipe: manifest.edit.recipe, recipeStrength: 0.5 } : {}), ...(manifest.edit?.templateRecipe ? { templateRecipe: manifest.edit.templateRecipe } : {}), ...(manifest.edit?.voiceover?.saved ? { voiceover: { url: jobFileLink(origin, row, "voiceover.mp3") } } : {}) });
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
  // What the Photo move 3.0 AI polish did (or why it was skipped), so the manager can see it.
  const polish = manifest.photoHybrid ? (state.hybrid?.length
    ? state.hybrid.map((item) => `Scene ${item.scene}: ${item.used === "ai" ? "AI polish kept" : "plain depth render kept"}${item.error ? ` (${item.error})` : item.mean !== undefined ? ` (lines held ${Math.round(item.mean * 100)}%)` : ""}`).join(" · ")
    : state.depthFallbacks ? `Depth step failed: ${state.depthError || "unknown"}` : "AI polish did not run (editing service has no record of it)") : undefined;
  await recordEditorState(env, { lastOkAt: Date.now(), ...(polish !== undefined ? { polishNote: polish.slice(0, 300) } : {}), ...(madeMusic ? { musicSource: state.musicSource, musicNote: state.musicError || "" } : {}) });
  if (state.music && !edit.music?.saved) {
    try {
      await storeResponse(env.BUCKET, musicKey(row.id), await editFile(env, row.id, key, "music"), "audio/mpeg");
      const prompt = edit.music?.prompt || musicPrompt({ aspect: row.aspect, duration: row.duration });
      manifest.edit = { ...manifest.edit, music: { prompt, saved: musicKey(row.id), source: state.musicSource } };
      // Keep what ElevenLabs made (not the weaker backup engine) so the library grows.
      const style = styleOfPrompt(prompt);
      const seconds = edit.music?.seconds || row.duration;
      if (style && state.musicSource === "elevenlabs" && !manifest.ads) {
        const stored = await env.BUCKET.get(musicKey(row.id));
        if (stored) await addTrack(env, { style, seconds, source: "elevenlabs", data: await stored.arrayBuffer() });
      }
    } catch { /* the next edit simply makes music again */ }
  }
  if (manifest.cards) manifest.cardsNote = state.cards ? "added" : `not added: ${String(state.cardsError || "the editor left them off").slice(0, 200)}`;
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
      if (!(error instanceof ProviderError && ["throttled", "credit", "transient", "budget"].includes(error.kind))) up.tries = (up.tries || 0) + 1;
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

/* What a flagged film needs: only the engine scenes that show the problem are made again, each with an
   added instruction that names it. The scene's own prompt is never touched. */
const FIX_NOTES: Record<string, string> = {
  jump: "Fix: the previous attempt had a sudden jump. Keep one continuous, smooth camera movement from the first frame to the last, with no cuts.",
  black: "Fix: the previous attempt had black frames. The picture must stay fully lit and visible from the first frame to the last.",
};
const VEHICLE_WORDS = /\b(car|cars|vehicle|vehicles|truck|suv|van|automobile)\b/i;
const VEHICLE_FIX = "Fix: the previous attempt moved a car or vehicle. Every parked car and vehicle in the photo is parked and must stay perfectly still, exactly where it is, with no rolling, turning, driving or reversing and no lights switching on. Only the camera moves.";
const fixSetting = async (env: { DB: D1Database }) => (await env.DB.prepare("SELECT value FROM platform_settings WHERE key = 'auto_fix'").first<{ value?: string }>().catch(() => null))?.value !== "off";

/* Reads the free check and the AI review of the edited film (before it is saved). Returns true when the film was
   sent back to be made again, false when it should be delivered (with an alert if it still has problems). */
async function judgeFilm(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, manifest: Required<ProductionManifest>, key: string): Promise<boolean> {
  try {
    const state = await editState(env, row.id, key);
    const count = manifest.inputs.length;
    const step = count > 1 ? Math.max(1, (manifest.edit?.shareSeconds || row.duration / count) - (manifest.edit?.crossfade || 0)) : row.duration;
    const sceneAt = (at: number) => Math.min(count - 1, Math.max(0, Math.floor(at / step)));
    const reasons = new Map<number, string[]>();
    const add = (scene: number, note: string) => reasons.set(scene, [...(reasons.get(scene) || []), note]);
    const issues = new Map<number, string[]>(); // what was found, in plain words, per scene (for the Quality tab)
    const found = (scene: number, text: string) => issues.set(scene, [...new Set([...(issues.get(scene) || []), text.slice(0, 240)])]);
    const qc = state.qc;
    let alertText = "";
    if (qc && qc.status !== "error") {
      manifest.qc = qc;
      for (const flag of qc.flags) if (flag.level === "fail" && flag.at !== undefined && FIX_NOTES[flag.code]) add(sceneAt(flag.at), FIX_NOTES[flag.code]);
      for (const flag of qc.flags) if (flag.at !== undefined) found(sceneAt(flag.at), flag.message);
      if (qc.status !== "pass") alertText += qc.flags.map((flag) => flag.message).join(" ");
    }
    const configured = await reviewSettings(env);
    const use = (await guardCheck(env, 0)).ok ? configured : { ...configured, cloudflare: false, claude: false }; // the spending guard: no paid AI quality check at the limit (the free mechanical check still runs)
    if (state.stills && (use.cloudflare || use.claude)) {
      const stills: Uint8Array[] = []; const times: number[] = [];
      for (let n = 1; n <= state.stills; n += 1) {
        stills.push(new Uint8Array(await (await editFile(env, row.id, key, `still/${n}` as `still/${number}`)).arrayBuffer()));
        times.push(Math.round(((n - 0.5) / state.stills) * (state.duration || row.duration) * 10) / 10);
      }
      const sources: (Uint8Array | null)[] = [];
      for (let n = 0; n < stills.length; n += 1) {
        try {
          const object = await env.BUCKET.get(frameKey(row.id, sceneAt(times[n])));
          if (!object) { sources.push(null); continue; }
          const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
          sources.push(bytes.byteLength <= REALITY_SOURCE_MAX_BYTES ? bytes : null);
        } catch { sources.push(null); }
      }
      const review = await reviewStills(env, stills, times, use, sources);
      manifest.aiReview = review;
      manifest.checkedFrames = Array.from({ length: count }, (_, scene) => times.filter((at) => sceneAt(at) === scene).length);
      if (review.costCents) await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS REAL) + CAST(excluded.value AS REAL) AS TEXT), updated_at = excluded.updated_at`).bind(`review-cost:${row.id}`, String(review.costCents), Date.now()).run().catch(() => undefined);
      if (review.status === "flag") {
        alertText += ` ${review.findings.map((item) => `At ${item.at} s: ${item.issue}.`).join(" ")}`;
        for (const item of review.findings) found(sceneAt(item.at), item.issue);
        for (const item of review.findings) add(sceneAt(item.at), VEHICLE_WORDS.test(item.issue) ? `${VEHICLE_FIX} (${item.issue}.)` : `Fix: the previous attempt showed this problem: ${item.issue}. Keep every straight line perfectly straight, keep every object exactly where the source photo has it, and add nothing that is not in the photo.`);
      }
    }
    await saveManifest(env, row.id, manifest);
    const round = manifest.fix?.round || 0;
    const scenes = [...reasons.keys()].filter((scene) => !manifest.photoMoves?.[scene]);
    if (autoRemake({ round, flagged: scenes.length, total: count, enabled: scenes.length > 0 && await fixSetting(env) }).go) {
      const notes = [...(manifest.fix?.notes || Array(count).fill(""))];
      const sent = [...(manifest.fix?.sent || [])];
      for (const scene of scenes) {
        notes[scene] = fixInstruction(issues.get(scene) || [], undefined, issues.get(scene)?.length ? "" : [...new Set(reasons.get(scene))].join(" ")).slice(0, 1500);
        sent.push({ round: round + 1, scene, text: notes[scene], by: "check" });
      }
      manifest.fix = { ...manifest.fix, round: round + 1, notes, sent, history: [...(manifest.fix?.history || []), { round: round + 1, scenes, why: alertText.trim().slice(0, 400), at: Date.now() }] };
      if (await remakeScenes(env, row, manifest, scenes, issues)) return true;
    }
    // Delivered as it is: remember which scenes still have a flag, so they can be previewed in History → Quality.
    if (issues.size) {
      manifest.fix = { ...manifest.fix, round, notes: manifest.fix?.notes || Array(count).fill(""), history: manifest.fix?.history || [], kept: manifest.fix?.kept, flagged: [...issues.entries()].map(([scene, list]) => ({ scene, issues: list })) };
      await saveManifest(env, row.id, manifest);
    }
    if (alertText.trim()) {
      if (round >= AUTO_FIX_ROUNDS) {
        await alertManagers(env, `Quality problem not fixed · ${videoRef(row.id)}`, `${videoRef(row.id)}: still has a problem after ${round + 1} attempts. ${alertText.trim()} Order ${row.id}. It is marked red in History: open it, tap Quality to see the flagged scenes full screen, and decide whether to deliver it or re-make it yourself.`);
      } else {
        await alertManagers(env, "A film has a quality problem", `${videoRef(row.id)}: ${alertText.trim()} Order ${row.id}. The film was delivered; open History, find ${videoRef(row.id)} and tap Quality to preview the flagged scenes and decide whether to re-make it.`);
      }
    } else if (round > 0) {
      await alertManagers(env, `Film fixed, ready to deliver · ${videoRef(row.id)}`, `${videoRef(row.id)}: the quality check found a problem, it was fixed on attempt ${round + 1} and the re-check passed. It is ready to deliver.`);
    }
  } catch { /* the check is a bonus: never lose a film over it */ }
  return false;
}

/* Sends the chosen scenes back to the engine (the job goes back to "generating"); the other scenes are kept. */
async function remakeScenes(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, manifest: Required<ProductionManifest>, scenes: number[], issues: Map<number, string[]> = new Map()) {
  const lease = await acquireLease(env, `job-lock:${row.id}`, 60 * 1000);
  if (!lease) return false;
  try {
    const fresh = await getRenderJob(env, row.id);
    if (!fresh) return false;
    const count = manifest.inputs.length;
    const { ids, segments } = alignedScenes(fresh, count);
    // Keep a copy of each flagged clip before it is replaced, so the owner can preview exactly what was flagged.
    const kept = [...(manifest.fix?.kept || [])];
    for (const index of scenes) {
      try {
        const source = await env.BUCKET.get(`render-jobs/${row.id}/out-${String(index + 1).padStart(2, "0")}.mp4`);
        if (source?.body) {
          const file = `flag-${String(index + 1).padStart(2, "0")}-r${manifest.fix?.round || 1}.mp4`;
          await env.BUCKET.put(`render-jobs/${row.id}/${file}`, source.body, { httpMetadata: { contentType: "video/mp4" } });
          kept.push({ scene: index, round: manifest.fix?.round || 1, file, issues: issues.get(index) || [] });
        }
      } catch { /* a missing preview never blocks the fix */ }
    }
    if (manifest.fix) manifest.fix = { ...manifest.fix, kept, flagged: undefined };
    // Which engine makes this try: same, then another, then Wan 3.0.
    const firstEngine = (manifest.fix?.firstEngine as StudioEngineKey | undefined) || manifest.engine;
    const target = fixEngine(firstEngine, manifest.fix?.round || 1);
    if (manifest.fix) manifest.fix = { ...manifest.fix, firstEngine };
    if (target !== manifest.engine) {
      const resolution = studioEngine(target).resolutions.includes(row.resolution as never) ? row.resolution as never : engineResolution(target);
      const second = filmSceneDurations(target, resolution).find((option) => option >= manifest.sceneSeconds) || Math.max(...filmSceneDurations(target, resolution));
      for (const index of scenes) {
        const link = manifest.photos?.[index]?.link;
        if (!link) return false;
        manifest.inputs[index] = buildEngineInput(target, { imageUrl: link, prompt: String(manifest.inputs[index]?.prompt || ""), duration: second, resolution, aspectRatio: row.aspect === "vertical" ? "9:16" : "16:9" });
        if (manifest.photos?.[index]) manifest.photos[index].file = undefined;
      }
      manifest.engine = target; manifest.endpoint = ENGINE_ENDPOINTS[target];
      if (engineUpscales(target, row.resolution as never)) manifest.upscale = { to: "1080p" }; else delete manifest.upscale;
    }
    if (manifest.fix) { const history = [...manifest.fix.history]; const last = history[history.length - 1]; if (last) history[history.length - 1] = { ...last, engine: target }; manifest.fix = { ...manifest.fix, history }; }
    for (const index of scenes) {
      ids[index] = ""; segments[index] = null;
      manifest.states[index] = "queued"; manifest.attempts[index] = 0; manifest.waits[index] = 0; manifest.nextAt[index] = 0; manifest.reasons[index] = "";
      manifest.outputs[index] = ""; manifest.saved[index] = ""; manifest.readyAt[index] = 0; manifest.lastErrors[index] = "";
    }
    manifest.stitchAttempts = 0;
    if (manifest.upscale) manifest.upscale = { to: "1080p" };
    if (manifest.edit) manifest.edit = { ...manifest.edit, key: undefined, tries: 0, startedAt: 0, lastError: "", usedBackupJoiner: false };
    const seconds = manifest.sceneSeconds;
    // A re-made scene costs what the engine really charges: its price at the resolution the film is made at (an upscaled
    // film is made at 720p), plus the upscale of the whole film again where there is one. (It used to use the engine's
    // top-resolution price, which overstated every re-make.)
    const made = nativeResolution(manifest.engine, row.resolution as never);
    const extra = Math.round((engineCost(manifest.engine, made, seconds) * scenes.length + (engineUpscales(manifest.engine, row.resolution as never) ? UPSCALE_PER_SECOND * row.duration : 0)) * 100);
    if (!(await guardCheck(env, extra)).ok) return false; // the spending guard: no re-make while a limit is reached or spending is paused
    if (manifest.fix) { const history = [...manifest.fix.history]; const last = history[history.length - 1]; if (last) history[history.length - 1] = { ...last, cents: extra }; manifest.fix = { ...manifest.fix, history }; }
    await saveManifest(env, row.id, manifest);
    await env.DB.prepare(`UPDATE render_jobs SET status = 'generating', cost_cents = cost_cents + ?, prediction_ids = ?, segment_urls = ?, stitch_prediction_id = NULL, history_id = NULL, error = NULL, updated_at = ? WHERE id = ?`).bind(extra, JSON.stringify(ids), JSON.stringify(segments), Date.now(), row.id).run();
    await alertManagers(env, "A film is being fixed", `${videoRef(row.id)}: the quality check found a problem, so ${scenes.length === 1 ? `scene ${scenes[0] + 1}` : `scenes ${scenes.map((scene) => scene + 1).join(", ")}`} of order ${row.id} ${scenes.length === 1 ? "is" : "are"} being made again with an added fix instruction (${(manifest.fix?.round || 1) > MAX_FIX_ROUNDS ? "fixed by hand" : `attempt ${(manifest.fix?.round || 1) + 1} of ${AUTO_FIX_ROUNDS + 1}`} on ${studioEngine(manifest.engine).name}, about $${(extra / 100).toFixed(2)} more). Open History, find ${videoRef(row.id)} and tap Quality to preview what was flagged.`);
    return true;
  } finally { await releaseLease(env, `job-lock:${row.id}`, lease); }
}

/* The engine and the price of the owner's "Fix this scene": a hand-requested fix always goes to the engine that has worked best (Wan 3.0). */
export function fixEstimate(manifest: ProductionManifest, row: { resolution: string; duration: number }) {
  const target = fixEngine((manifest.fix?.firstEngine as StudioEngineKey | undefined) || manifest.engine, Math.max((manifest.fix?.round || 0) + 1, MAX_FIX_ROUNDS + 1));
  const made = nativeResolution(target, row.resolution as never);
  const cents = Math.round((engineCost(target, made, manifest.sceneSeconds) + (engineUpscales(target, row.resolution as never) ? UPSCALE_PER_SECOND * row.duration : 0)) * 100);
  return { engine: target, cents };
}

/* "Fix this scene": the owner taps it on one scene of a finished film. A full instruction is written from everything the check
   recorded about that scene plus the standing camera-only rules, then only that scene is made again; the film is joined again and the
   result lands in History as a new version (the first version stays). Checked once more afterwards, but never re-made automatically again. */
export async function fixSceneByHand(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, scene: number, token: string, webhookUrl?: string): Promise<{ ok: true; text: string; cents: number } | { error: string }> {
  if (!QUEUE_KINDS.has(row.kind) || row.kind === "ad-series") return { error: "This kind of video cannot be fixed scene by scene." };
  if (row.status !== "succeeded") return { error: row.status === "failed" ? "Use Resume or Start over for a stopped video." : "This video is still being made. Try again when it is finished." };
  const loaded = await loadManifest(env, row.id);
  if (!loaded) return { error: "This video was made before it could be fixed scene by scene." };
  const manifest = normalizeManifest(loaded) as Required<ProductionManifest>;
  const count = manifest.inputs.length;
  if (!Number.isInteger(scene) || scene < 0 || scene >= count) return { error: "Choose a scene." };
  if (manifest.photoMoves?.[scene]) return { error: "This scene is a photo move made by the editor, not by a video engine, so there is nothing to make again." };
  if (manifest.fromClips) return { error: "This film was made from saved clips." };
  if (!manifest.photos?.[scene]?.link) return { error: "This scene's photo is no longer stored." };
  const flagged = manifest.fix?.flagged?.find((item) => item.scene === scene)?.issues;
  const lastKept = [...(manifest.fix?.kept || [])].reverse().find((item) => item.scene === scene)?.issues;
  const issues = flagged?.length ? flagged : lastKept || [];
  const text = fixInstruction(issues, undefined, "This fix was asked for by hand, so check every point above with extra care.").slice(0, 1500);
  const round = Math.max((manifest.fix?.round || 0) + 1, MAX_FIX_ROUNDS + 1); // past the automatic limit: the check will not make it again by itself
  const notes = [...(manifest.fix?.notes || Array(count).fill(""))];
  notes[scene] = text;
  const { cents } = fixEstimate(manifest, row);
  const spend = await guardCheck(env, cents);
  if (!spend.ok) return { error: spend.message };
  manifest.fix = { ...manifest.fix, round, notes, history: [...(manifest.fix?.history || []), { round, scenes: [scene], why: `Fix this scene (asked by hand): ${issues.join(" ").slice(0, 300)}`, at: Date.now() }], sent: [...(manifest.fix?.sent || []), { round, scene, text, by: "you" }] };
  if (!await remakeScenes(env, row, manifest, [scene], new Map([[scene, issues]]))) return { error: "This video is being updated right now. Try again in a few seconds." };
  const fresh = await getRenderJob(env, row.id);
  if (fresh) await advanceRenderJob(env, fresh, token, webhookUrl);
  return { ok: true, text, cents };
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
  if (manifest && film && row.kind !== "ad-series" && !manifest.fromClips && !(upscaling && manifest.upscale?.stored) && await judgeFilm(env, fresh, manifest as Required<ProductionManifest>, key)) {
    await film.body?.cancel().catch(() => undefined);
    await dropEdit(env, row.id, key);
    return null;
  }
  if (upscaling) {
    const out = await upscaleFilm(env, fresh, manifest!, film, ctx!);
    if (!out) return null;
    film = out.response;
  }
  const historyId = await storeFinishedFilm(env, fresh, film!, `composer:${key}`);
  if (manifest?.upscale?.stored) await env.BUCKET.delete(composedKey(row.id)).catch(() => undefined);
  await dropEdit(env, row.id, key);
  return historyId;
}

/** How long the server waits for the photos of a new film (each photo that arrives restarts the wait). Nothing is made or charged while it waits. */
const PHOTO_WAIT_MS = 10 * 60 * 1000;

export async function advanceRenderJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  if (["succeeded", "failed"].includes(row.status)) {
    // The film finished or stopped: a line of edits waiting on it starts (or is held) — the queue advances itself.
    await advanceEditQueue(env, row, token, webhookUrl).catch(() => undefined);
    return (await getRenderJob(env, row.id)) || row;
  }
  try {
    // The photos are still on their way (a phone on a slow connection can take minutes for the first one): wait 5 minutes, not 90 seconds, for photos that have not arrived. Every photo that arrives restarts the wait.
    if (row.status === "starting" && Date.now() - row.updatedAt > 90 * 1000 && Date.now() - row.updatedAt <= PHOTO_WAIT_MS && row.kind.startsWith("studio-")) {
      const waiting = await loadManifest(env, row.id);
      if (waiting && (await framesPresent(env, row.id, waiting.inputs.length)).some((value) => !value)) return row;
    }
    if (row.status === "starting" && Date.now() - row.updatedAt > 90 * 1000) {
      // The start was cut off (a refresh or dropped connection while the
      // photos were sent): carry on from where it was.
      const manifest = await loadManifest(env, row.id);
      if (!manifest) {
        if (Date.now() - row.updatedAt > 10 * 60 * 1000) throw new Error("The video could not start. Please try again.");
      } else {
        const present = row.kind.startsWith("studio-") ? await framesPresent(env, row.id, manifest.inputs.length) : [];
        if (present.some((value) => !value)) throw new Error(`The photos did not finish sending: ${present.filter(Boolean).length} of ${present.length} photos reached the server in the ${Math.round(PHOTO_WAIT_MS / 60000)} minutes after the film was created. Nothing was made or charged.`);
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
      if (finalUrl.startsWith("composer:")) { if (Date.now() - row.updatedAt > 20 * 1000) await saveComposedFilm(env, row, finalUrl.slice("composer:".length), { token, origin: webhookUrl ? new URL(webhookUrl).origin : "" }); const fresh = await getRenderJob(env, row.id); if (fresh?.status === "succeeded") await advanceEditQueue(env, fresh, token, webhookUrl).catch(() => undefined); return getRenderJob(env, row.id); }
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
  const fresh = await getRenderJob(env, row.id);
  // A film that just finished or stopped: a line of edits waiting on it starts (or is held).
  if (fresh && ["succeeded", "failed"].includes(fresh.status)) await advanceEditQueue(env, fresh, token, webhookUrl).catch(() => undefined);
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
    motion: motionLabel(row.prompt),
  };
}

/* Per-scene detail for the progress views: state, why it is waiting, when it
   goes next, tries, last provider message and engine job ID (the last two
   are shown to the manager only). */
/* "added", "not added: why", or "" when no cards were asked for. */
export async function jobCardsNote(env: { BUCKET: R2Bucket }, row: RenderJobRow): Promise<string> {
  const loaded = await loadManifest(env, row.id);
  if (!loaded?.cards) return "";
  return loaded.cardsNote || (["stitching", "saving", "succeeded"].includes(row.status) ? "not added: the editor did not run for this film" : "");
}

export async function jobScenes(env: { BUCKET: R2Bucket }, row: RenderJobRow) {
  return (await jobSceneDetail(env, row))?.scenes ?? null;
}

/* The scenes plus what the manager's Production page needs to explain a video: when each scene finished and the
   quality re-makes (round, scenes, why, cost, time). */
export async function jobSceneDetail(env: { BUCKET: R2Bucket }, row: RenderJobRow) {
  const loaded = await loadManifest(env, row.id);
  if (!loaded) return null;
  const manifest = normalizeManifest(loaded);
  const finishing = ["stitching", "saving", "succeeded"].includes(row.status);
  const { ids } = alignedScenes(row, manifest.inputs.length);
  const scenes = manifest.states.map((state, index) => ({
    state: finishing ? "ready" : state === "waiting" ? "queued" : state === "retrying" ? "retry" : state,
    attempt: manifest.attempts[index] || 0,
    reason: finishing ? "" : manifest.reasons[index] || "",
    nextAt: manifest.nextAt[index] || 0,
    error: manifest.lastErrors[index] || "",
    engine: finishing ? "" : manifest.engineSeen?.[index]?.status || "",
    engineSince: finishing ? 0 : manifest.engineSeen?.[index]?.since || 0,
    startedAt: finishing ? 0 : manifest.startedAt[index] || 0,
    readyAt: manifest.readyAt?.[index] || 0,
    predictionId: ids[index] && !ids[index].startsWith("pending-") && !ids[index].startsWith("resume-") ? ids[index] : "",
    saved: Boolean(manifest.saved[index]),
    motion: motionLabel(String(manifest.inputs[index]?.prompt || "")),
    // A stopped video's finished scene whose engine copy has expired and was never kept: Resume makes it again.
    expired: row.status === "failed" && (finishing ? false : state === "ready") && !manifest.saved[index] && Date.now() - (manifest.readyAt[index] || 0) > 45 * 60 * 1000,
  }));
  return { scenes, engine: String(manifest.engine || ""), firstEngine: String(manifest.startedEngine || manifest.fix?.firstEngine || manifest.engine || ""), fix: (manifest.fix?.history || []).map((item) => ({ round: item.round, scenes: item.scenes, why: item.why, cents: item.cents || 0, engine: item.engine || "", at: item.at || 0 })) };
}

/* What the provider is doing right now, for the progress views. */
export async function providerNote(env: { DB: D1Database }) {
  const state = await readProviderState(env);
  const now = Date.now();
  return {
    waitingUntil: Math.max(state.throttledUntil, state.pausedUntil) > now ? Math.max(state.throttledUntil, state.pausedUntil) : 0,
    paused: state.pausedUntil > now,
    lowCredit: state.lowCredit && Date.now() - state.lastErrorAt < 2 * 60 * 60 * 1000, // a warning from hours ago is not today's news
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
  const stopped = await env.DB.prepare(`SELECT j.id FROM render_jobs j WHERE j.kind = 'customer-series' AND j.status = 'failed' AND j.updated_at < ? AND j.updated_at > ? AND COALESCE(j.error, '') NOT LIKE 'Stopped%' AND COALESCE(j.error, '') NOT LIKE 'Replaced%' AND COALESCE((SELECT CAST(value AS INTEGER) FROM platform_settings WHERE key = 'job_recoveries:' || j.id), 0) < ? ORDER BY j.updated_at ASC LIMIT 2`).bind(now - 90 * 1000, now - 6 * 60 * 60 * 1000, MAX_RECOVERIES).all<{ id: string }>();
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
/* "Upscale to 1080p": the last touch on a version that was approved at 720p. The film is joined again with the upscale on (its scenes, music and
   edit are kept), so a new 1080p version lands in History and the 720p one stays. Costs the upscale only (UPSCALE_PER_SECOND × seconds). */
export async function upscaleFinal(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string): Promise<{ ok: true; cents: number } | { error: string }> {
  if (row.status !== "succeeded") return { error: "Wait until this film is finished." };
  const loaded = await loadManifest(env, row.id);
  if (!loaded) return { error: "This film cannot be upscaled." };
  const manifest = normalizeManifest(loaded);
  if (!engineUpscales(manifest.engine, "1080p")) return { error: "This film's engine already makes its own resolution." };
  if (row.resolution === "1080p" || manifest.upscale) return { error: "This film is already 1080p." };
  const cents = Math.round(UPSCALE_PER_SECOND * row.duration * 100);
  const spend = await guardCheck(env, cents);
  if (!spend.ok) return { error: spend.message };
  manifest.upscale = { to: "1080p" };
  await saveManifest(env, row.id, manifest);
  await env.DB.prepare(`UPDATE render_jobs SET resolution = '1080p', cost_cents = cost_cents + ?, updated_at = ? WHERE id = ?`).bind(cents, Date.now(), row.id).run();
  const fresh = await getRenderJob(env, row.id);
  if (!fresh) return { error: "Film not found." };
  const result = await runJobAction(env, fresh, "reassemble", null, token, webhookUrl);
  if ("error" in result) {
    delete manifest.upscale; await saveManifest(env, row.id, manifest);
    await env.DB.prepare(`UPDATE render_jobs SET resolution = ?, cost_cents = cost_cents - ?, updated_at = ? WHERE id = ?`).bind(row.resolution, cents, Date.now(), row.id).run();
    return result;
  }
  return { ok: true, cents };
}

/* ---- Edit a finished film (shared by the Edit route and the submission queue) ----
   Change a finished film's listing cards, music, voiceover and sound effects,
   or make single scenes again with a new camera movement. The scenes that are
   kept are not made again (nothing is charged for them); only a scene made
   again costs. The caller passes the provider token (or null when the engine
   is not connected) and the webhook URL the provider calls back on. */
export type FilmEditBody = {
  cards?: unknown;
  music?: unknown;
  voice?: { mode?: unknown; voiceId?: unknown; lines?: unknown; film?: unknown } | null;
  sfx?: { on?: unknown; prompts?: unknown } | null;
  scenes?: { scene?: unknown; prompt?: unknown; photoMove?: unknown; photo?: unknown }[];
  /** Edit the same scenes with a MotionWren template ("wren:…"), from the scenes listed in useScenes (all when left out). */
  template?: unknown;
  useScenes?: unknown;
  /** Cinematic titles: an object to set them, null to remove them. */
  titles?: unknown;
  /** Cut the finished film to 16:9 or vertical ("made" goes back to the frame it was made at). Nothing is made again. */
  frame?: unknown;
};

export type FilmEditResult =
  | { job: Record<string, unknown>; warning?: string }
  | { error: string; fix?: string; status: number };

const editText = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

export async function applyFilmEdit(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, body: FilmEditBody, token: string | null, webhookUrl?: string): Promise<FilmEditResult> {
  const id = row.id;
  if (!token) return { error: "The video engine is not connected yet.", status: 503 };
  const manifest = await loadManifest(env, id);
  if (!manifest) return { error: "This film was made before it could be edited.", status: 409 };
  const count = manifest.inputs.length;
  const edit = manifest.edit || (manifest.edit = {});
  const sound = edit.sound || (edit.sound = {});

  // The kept scenes must still be stored.
  const redo = new Set((Array.isArray(body.scenes) ? body.scenes : []).map((item) => Number(item.scene)).filter((scene) => Number.isInteger(scene) && scene >= 0 && scene < count));
  for (let index = 0; index < count; index += 1) {
    if (redo.has(index) || manifest.photoMoves?.[index]) continue;
    if (!await env.BUCKET.head(outputKey(id, index))) return { error: "This film's scenes are no longer stored, so it can't be edited. Make it again from its photos.", status: 409 };
  }

  // A MotionWren template applied to the kept scenes (nothing is made again, so nothing is charged).
  if (typeof body.template === "string" && body.template) {
    if (!isWrenId(body.template)) return { error: "Unknown template.", status: 400 };
    const wren = await getRecipe(env, body.template);
    if (!wren) return { error: "That template is no longer available.", status: 400 };
    const chosen = Array.isArray(body.useScenes) ? [...new Set((body.useScenes as unknown[]).map(Number))].filter((index) => Number.isInteger(index) && index >= 0 && index < count && !manifest.photoMoves?.[index]) : [];
    const used = chosen.length ? chosen : Array.from({ length: count }, (_, index) => index);
    if (used.length < 2) return { error: "Choose at least two clips.", status: 400 };
    if (used.length < count && (sound.voice || sound.sfx)) return { error: "This film has a voice or scene sounds, which belong to all of its scenes. Edit it with every clip, or turn them off first.", status: 400 };
    const recipe = recipeFor(wren, used.length);
    edit.recipe = recipe; edit.crossfade = 0; edit.useScenes = used.length < count ? used : undefined;
    delete edit.grade; delete edit.subtitles;
    if (recipe.audio?.sfx?.length) {
      try { const cutfx = await makeCutEffects(env, id, recipe.audio, joinTimes(recipe)); if (cutfx) sound.cutfx = cutfx; else delete sound.cutfx; } catch { delete sound.cutfx; }
    } else delete sound.cutfx;
  }

  // Cut to another frame: the stored clips are re-framed at the final edit, so nothing is made again and nothing is charged.
  if (body.frame === "horizontal" || body.frame === "vertical" || body.frame === "square" || body.frame === "portrait" || body.frame === "made") {
    if (body.frame === "made" || body.frame === row.aspect) delete edit.reframe; else edit.reframe = body.frame;
  }

  if (body.titles !== undefined) { const titles = body.titles === null ? undefined : cleanFilmTitles(body.titles); if (titles) edit.titles = titles; else delete edit.titles; }

  // Sound first: if a voice or effect can't be made, nothing else changes.
  try {
    if (body.voice !== undefined) {
      const mode = body.voice?.mode;
      if (mode === "off" || body.voice === null) delete sound.voice;
      else if (mode === "scene" || mode === "film") {
        const voiceId = editText(body.voice?.voiceId, 64);
        if (!voiceId) return { error: "Choose a voice.", status: 400 };
        const lines = Array.isArray(body.voice?.lines) ? (body.voice!.lines as unknown[]).map((line) => editText(line, 400)) : [];
        sound.voice = await makeVoice(env, id, { mode, voiceId, lines: Array.from({ length: count }, (_, index) => lines[index] || ""), film: editText(body.voice?.film, 4000) }, count);
      }
    }
    if (body.sfx !== undefined) {
      if (!body.sfx || body.sfx.on !== true) delete sound.sfx;
      else {
        const prompts = Array.isArray(body.sfx.prompts) ? (body.sfx.prompts as unknown[]).map((prompt) => editText(prompt, 140)) : [];
        const made = await makeSfx(env, id, Array.from({ length: count }, (_, index) => prompts[index] || ""), Math.min(edit.shareSeconds || manifest.sceneSeconds, 12));
        if (made) sound.sfx = made; else { delete sound.sfx; return { error: "None of the scenes has a sound to add. Describe one, or turn sound effects off.", status: 400 }; }
      }
    }
  } catch (error) {
    if (error instanceof ElevenLabsMissingKey) return { error: "The ElevenLabs key is not added yet.", fix: "elevenlabs", status: 503 };
    const message = error instanceof Error ? error.message : "The sound could not be made.";
    return { error: message, fix: /402|paid_plan|payment_required|quota/i.test(message) ? "elevenlabs" : undefined, status: 502 };
  }

  if (body.cards !== undefined) {
    // "keep" in the logo field means: the closing card keeps the logo it already has.
    const incoming = body.cards as { closing?: { logo?: unknown } | null } | null;
    if (incoming?.closing && incoming.closing.logo === "keep") incoming.closing.logo = manifest.cards?.closing?.logo || "";
    const cards = body.cards === null ? undefined : cleanCards(body.cards); if (cards) manifest.cards = cards; else delete manifest.cards;
  }
  if (typeof body.music === "string" && body.music !== "keep") {
    if (body.music === "none") sound.noMusic = true;
    else {
      const template = musicTemplate(body.music);
      if (!template) return { error: "Unknown music.", status: 400 };
      delete sound.noMusic;
      edit.music = { prompt: template.prompt }; // a new prompt: the old saved track is not reused
    }
  }
  // A camera movement changed for a scene: that scene is made again.
  for (const item of Array.isArray(body.scenes) ? body.scenes : []) {
    const scene = Number(item.scene);
    if (!redo.has(scene)) continue;
    if (!manifest.photoMoves?.[scene] && item.photo && typeof item.photo === "object" && typeof (item.photo as { queuedPhoto?: unknown }).queuedPhoto === "string") {
      // A queued edit's new photo, waiting in R2 since it was submitted: move it onto the scene's photo now.
      const queuedKey = (item.photo as { queuedPhoto: string }).queuedPhoto;
      const stored = await env.BUCKET.get(queuedKey);
      if (!stored?.body) return { error: `The new photo for scene ${scene + 1} could not be found. Submit the edit again.`, status: 409 };
      const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
      const key = manifest.photos?.[scene]?.key || frameKey(id, scene);
      await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      await env.BUCKET.delete(queuedKey).catch(() => undefined);
      if (manifest.photos?.[scene]) manifest.photos[scene].file = undefined;
    } else if (!manifest.photoMoves?.[scene] && typeof item.photo === "string" && /^data:image\/jpeg;base64,/.test(item.photo) && item.photo.length <= 10_400_000) {
      // A new photo for this scene: it replaces the stored one, and the engine is handed the new file.
      const bytes = Uint8Array.from(atob(item.photo.slice(item.photo.indexOf(",") + 1)), (char) => char.charCodeAt(0));
      const key = manifest.photos?.[scene]?.key || frameKey(id, scene);
      await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      if (manifest.photos?.[scene]) manifest.photos[scene].file = undefined;
    }
    if (manifest.photoMoves?.[scene] && (PHOTO_MOVE_KEYS as readonly string[]).includes(String(item.photoMove))) manifest.photoMoves[scene] = String(item.photoMove);
    else if (typeof item.prompt === "string" && item.prompt.trim().length >= 20 && typeof manifest.inputs[scene].prompt === "string") manifest.inputs[scene] = { ...manifest.inputs[scene], prompt: item.prompt.trim().slice(0, 6000) };
  }
  await saveManifest(env, id, manifest);

  let current = row; let failure = "";
  const scenesToMake = [...redo].filter((scene) => !manifest.photoMoves?.[scene] ? true : false);
  if (scenesToMake.length) {
    for (const scene of scenesToMake) {
      const result = await runJobAction(env, current, "regenerate-scene", scene, token, webhookUrl);
      if ("error" in result) { failure = result.error; break; }
      current = (await getRenderJob(env, id)) || current;
    }
  }
  if (!scenesToMake.length || failure) {
    const result = await runJobAction(env, current, "reassemble", null, token, webhookUrl);
    if ("error" in result) return { error: failure || result.error, status: 409 };
  }
  const fresh = await getRenderJob(env, id);
  return { job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh), cardsNote: await jobCardsNote(env, fresh) } : {}, ...(failure ? { warning: failure } : {}) };
}

/* ---- Submission queue: edits that wait in line ----
   An edit submitted while its film is busy (generating, stitching, saving) is
   accepted and waits in line on the film's manifest, then runs automatically
   in submission order when the film before it finishes — no "wait until
   complete", no manual re-submit. The line is pumped by advanceRenderJob
   (below): the heartbeat, webhooks and page views all drive it, so no new
   scheduler is needed. A queued edit is never dropped silently: if the film
   it waits on stops, the line is held with the reason; if the queued edit
   itself cannot run, it fails loudly (notification) and the line moves on. */
export type QueuedEditSummary = { id: string; label: string; status: "waiting" | "held"; position: number; holdReason?: string; submittedAt: number };

/** Plain-language summary of an edit for the line ("Cut to 16:9 · New music"). */
export function editQueueLabel(body: FilmEditBody): string {
  const parts: string[] = [];
  if (body.frame === "horizontal") parts.push("Cut to 16:9");
  else if (body.frame === "vertical") parts.push("Cut to 9:16");
  else if (body.frame === "square") parts.push("Cut to 1:1");
  else if (body.frame === "portrait") parts.push("Cut to 4:5");
  else if (body.frame === "made") parts.push("Back to the original frame");
  if (typeof body.template === "string" && body.template) parts.push("Apply a template");
  if (typeof body.music === "string" && body.music !== "keep") parts.push(body.music === "none" ? "Remove the music" : "New music");
  if (body.voice !== undefined && body.voice !== null) parts.push(body.voice?.mode === "off" ? "Remove the voiceover" : "New voiceover");
  if (body.sfx !== undefined && body.sfx !== null) parts.push(body.sfx?.on === true ? "New scene sounds" : "Remove the scene sounds");
  if (body.cards !== undefined) parts.push("New listing cards");
  if (body.titles !== undefined) parts.push("New titles");
  const remade = Array.isArray(body.scenes) ? body.scenes.map((item) => Number(item.scene)).filter((scene) => Number.isInteger(scene)) : [];
  if (remade.length === 1) parts.push(`Remake scene ${remade[0] + 1}`);
  else if (remade.length > 1) parts.push(`Remake ${remade.length} scenes`);
  return parts.slice(0, 3).join(" · ") || "Edit the film";
}

/** What the Studio shows for the line. A film that has stopped holds the whole line: entries wait (never dropped) until the film runs again. */
export function queueSummary(manifest: ProductionManifest | null | undefined, row?: { status: string; error?: string | null } | null): QueuedEditSummary[] {
  if (!manifest?.editQueue?.length) return [];
  return manifest.editQueue.map((entry, index) => {
    const held = entry.status === "held" || (row?.status === "failed" && entry.status === "waiting");
    return { id: entry.id, label: entry.label, status: held ? "held" : "waiting", position: index + 1, ...(held ? { holdReason: entry.holdReason || (row?.error ? `The film stopped: ${customerSafeError(row.error).slice(0, 200)}` : "The film stopped.") } : {}), submittedAt: entry.submittedAt };
  });
}

/** Accept an edit while its film is busy: it waits in line instead of being refused. New photos are moved to R2 at once (queue keys), so the queued body never carries photo bytes. */
export async function enqueueEdit(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, body: FilmEditBody): Promise<{ entry: QueuedEdit; position: number; queue: QueuedEditSummary[] } | { error: string }> {
  const manifest = await loadManifest(env, row.id);
  if (!manifest) return { error: "This film was made before it could be edited." };
  const count = manifest.inputs.length;
  const redo = new Set((Array.isArray(body.scenes) ? body.scenes : []).map((item) => Number(item.scene)).filter((scene) => Number.isInteger(scene) && scene >= 0 && scene < count));
  // No kept-scenes check here: while the film is still being made its scenes do not exist yet. applyFilmEdit checks them again at run time, once the film has finished.
  // Fail fast on an edit that could never run, so it never sits in line and fails later.
  if (typeof body.template === "string" && body.template) {
    if (!isWrenId(body.template)) return { error: "Unknown template." };
    const wren = await getRecipe(env, body.template);
    if (!wren) return { error: "That template is no longer available." };
    const chosen = Array.isArray(body.useScenes) ? [...new Set((body.useScenes as unknown[]).map(Number))].filter((index) => Number.isInteger(index) && index >= 0 && index < count && !manifest.photoMoves?.[index]) : [];
    const used = chosen.length ? chosen : Array.from({ length: count }, (_, index) => index);
    if (used.length < 2) return { error: "Choose at least two clips." };
  }
  if (typeof body.music === "string" && body.music !== "keep" && body.music !== "none" && !musicTemplate(body.music)) return { error: "Unknown music." };
  if (body.voice !== undefined && body.voice !== null && (body.voice?.mode === "scene" || body.voice?.mode === "film") && !editText(body.voice?.voiceId, 64)) return { error: "Choose a voice." };
  if (body.frame !== undefined && !["horizontal", "vertical", "square", "portrait", "made"].includes(String(body.frame))) return { error: "Unknown frame." };
  const queueId = crypto.randomUUID();
  const storedBody = JSON.parse(JSON.stringify(body)) as FilmEditBody;
  for (const item of Array.isArray(storedBody.scenes) ? storedBody.scenes : []) {
    const scene = Number(item.scene);
    if (!redo.has(scene)) continue;
    if (!manifest.photoMoves?.[scene] && typeof item.photo === "string" && /^data:image\/jpeg;base64,/.test(item.photo) && item.photo.length <= 10_400_000) {
      const bytes = Uint8Array.from(atob(item.photo.slice(item.photo.indexOf(",") + 1)), (char) => char.charCodeAt(0));
      const key = queuedPhotoKey(row.id, queueId, scene);
      await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      (item as { photo?: unknown }).photo = { queuedPhoto: key };
    } else if (typeof item.photo === "string") delete (item as { photo?: unknown }).photo; // a photo that could not be used: the scene is remade without it, as a direct edit would
  }
  const entry: QueuedEdit = { id: queueId, body: storedBody as unknown as Record<string, unknown>, label: editQueueLabel(body), status: "waiting", submittedAt: Date.now() };
  manifest.editQueue = [...(manifest.editQueue || []), entry];
  await saveManifest(env, row.id, manifest);
  return { entry, position: manifest.editQueue.length, queue: queueSummary(manifest, row) };
}

/** Take one edit out of the line (a new photo waiting for it is dropped with it). */
export async function cancelQueuedEdit(env: { DB: D1Database; BUCKET: R2Bucket }, jobId: string, queueId: string): Promise<{ queue: QueuedEditSummary[] } | { error: string }> {
  const manifest = await loadManifest(env, jobId);
  if (!manifest?.editQueue?.length) return { error: "There is no edit in line to cancel." };
  const entry = manifest.editQueue.find((item) => item.id === queueId);
  if (!entry) return { error: "That edit is no longer in line." };
  for (const item of Array.isArray((entry.body as FilmEditBody).scenes) ? (entry.body as FilmEditBody).scenes! : []) {
    const key = (item.photo as { queuedPhoto?: unknown } | undefined)?.queuedPhoto;
    if (typeof key === "string") await env.BUCKET.delete(key).catch(() => undefined);
  }
  manifest.editQueue = manifest.editQueue.filter((item) => item.id !== queueId);
  await saveManifest(env, jobId, manifest);
  const row = await getRenderJob(env, jobId);
  return { queue: queueSummary(manifest, row) };
}

async function notifyEditFailed(env: { DB: D1Database }, row: RenderJobRow, entry: QueuedEdit, error: string) {
  const now = Date.now();
  await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'edit_failed', 'An edit in line could not run', ?, NULL, ?)`).bind(`${entry.id}:edit-failed`, row.ownerId, `${entry.label}: ${customerSafeError(error).slice(0, 300)}`, now).run().catch(() => undefined);
}

/** Pump the line. Called by advanceRenderJob whenever a job is looked at (heartbeat, webhooks, page views, after an action): no new scheduler.
    - The film finished: the next edit in line starts (in submission order). A film that runs again un-holds the line first.
    - The film stopped: the whole line is held with the reason — never dropped, never run against a failed film.
    - Otherwise (the film is still busy): nothing to do; the line waits.
    A queued edit that cannot run fails loudly (notification) and the line moves on — unless the engine itself is unreachable, in which case the line waits for the next advance. */
export async function advanceEditQueue(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string): Promise<{ started: boolean; held?: number; failed?: { id: string; error: string }[] }> {
  if (!row) return { started: false };
  if (row.status === "failed") {
    const manifest = await loadManifest(env, row.id).catch(() => null);
    if (!manifest?.editQueue?.length) return { started: false };
    const reason = `The film stopped: ${customerSafeError(row.error || "The film stopped.").slice(0, 200)}`;
    let held = 0;
    for (const entry of manifest.editQueue) if (entry.status === "waiting") { entry.status = "held"; entry.holdReason = reason; held += 1; }
    if (held) await saveManifest(env, row.id, manifest);
    return { started: false, held };
  }
  if (row.status !== "succeeded") return { started: false };
  const manifest = await loadManifest(env, row.id).catch(() => null);
  if (!manifest?.editQueue?.length) return { started: false };
  let changed = false;
  for (const entry of manifest.editQueue) if (entry.status === "held") { entry.status = "waiting"; delete entry.holdReason; changed = true; }
  if (changed) await saveManifest(env, row.id, manifest);
  if (!token) return { started: false };
  const failed: { id: string; error: string }[] = [];
  // In submission order, until one edit starts (or the line is empty). Bounded by the line's length.
  for (let guard = 0; guard < manifest.editQueue.length; guard += 1) {
    const live = await getRenderJob(env, row.id);
    if (!live || live.status !== "succeeded") break; // the film stopped or started again: the line waits (a stop holds it on the next advance)
    const current = await loadManifest(env, row.id).catch(() => null);
    if (!current?.editQueue?.length) break;
    const entry = current.editQueue[0];
    const result = await applyFilmEdit(env, live, entry.body as unknown as FilmEditBody, token, webhookUrl);
    if ("job" in result) {
      const done = await loadManifest(env, row.id).catch(() => null);
      if (done?.editQueue) { done.editQueue = done.editQueue.filter((item) => item.id !== entry.id); await saveManifest(env, row.id, done); }
      return { started: true, failed: failed.length ? failed : undefined };
    }
    const transient = /not connected|being updated right now|try again/i.test(result.error);
    const gone = await loadManifest(env, row.id).catch(() => null);
    if (gone?.editQueue) { gone.editQueue = gone.editQueue.filter((item) => item.id !== entry.id); await saveManifest(env, row.id, gone); }
    failed.push({ id: entry.id, error: result.error });
    await notifyEditFailed(env, row, entry, result.error);
    if (transient) break; // the engine is unreachable: the rest of the line waits for the next advance
  }
  return { started: false, failed: failed.length ? failed : undefined };
}

export async function runJobAction(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, action: JobAction, scene: number | null, token: string, webhookUrl?: string) {
  if (action === "restart-scene" && scene !== null) {
    // Stop the engine's copy first (so it is not paid for twice), then send the scene again.
    const { ids } = alignedScenes(row, (await loadManifest(env, row.id))?.inputs.length || 0);
    if (ids[scene]) await cancelProviderJob(token, ids[scene]).catch(() => undefined);
  }
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
