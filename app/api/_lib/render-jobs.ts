import { getChatGPTUser } from "../../chatgpt-auth";
import { cookies } from "next/headers";
import { customerSafeError } from "./customer-errors";
import { frameKey, framesPresent, loadManifest, newManifest, normalizeManifest, saveManifest } from "./production";
import { classify, ProviderError, providerUrl, readProviderState, writeProviderState } from "./provider";
import { QUEUE_KINDS, alignedScenes, applyJobAction, stepSceneQueue, stitchSources, type JobAction } from "./scene-queue";

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
  const body = sizeBytes ? upstream.body : await upstream.arrayBuffer();
  await env.BUCKET.put(r2Key, body, { httpMetadata: { contentType: contentType === "application/octet-stream" ? "video/mp4" : contentType } });
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

async function sendAccountEmail(env: { DB: D1Database }, ownerId: string, subject: string, text: string) {
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

async function failRenderJob(env: { DB: D1Database }, row: RenderJobRow, message: string) {
  const now = Date.now();
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
      if (segments.length === 1) {
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

/* Joins the finished scenes. A provider "slow down" here is a wait, not a
   failure: the job stays "joining" and the next step tries again. */
async function startJoin(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  const loaded = await loadManifest(env, row.id);
  const manifest = loaded ? normalizeManifest(loaded) : null;
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
export async function advanceStaleJobs(env: { DB: D1Database; BUCKET: R2Bucket }, origin: string, ownerId: string | null, limit = 3) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return 0;
  const query = `SELECT id FROM render_jobs WHERE status IN ('starting','generating','stitching','saving') AND updated_at < ?${ownerId ? " AND owner_id = ?" : ""} ORDER BY updated_at ASC LIMIT ?`;
  const cutoff = Date.now() - 45 * 1000;
  const stale = ownerId
    ? await env.DB.prepare(query).bind(cutoff, ownerId, limit).all<{ id: string }>()
    : await env.DB.prepare(query).bind(cutoff, limit).all<{ id: string }>();
  for (const item of stale.results) {
    const row = await getRenderJob(env, item.id);
    if (!row || !row.webhookToken) continue;
    await advanceRenderJob(env, row, token, `${origin}/api/webhooks/replicate/${row.id}?token=${row.webhookToken}`).catch(() => undefined);
  }
  return stale.results.length;
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
