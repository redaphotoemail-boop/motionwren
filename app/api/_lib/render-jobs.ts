import { cookies, headers } from "next/headers";
import { customerSafeError } from "./customer-errors";

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
  const authenticatedId = (await headers()).get("oai-authenticated-user-id");
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
    return url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery") || Boolean(compositorHost && url.hostname === compositorHost)) ? url.toString() : null;
  } catch { return null; }
}

export function outputUrl(value: unknown) {
  if (Array.isArray(value)) return safeReplicateUrl(value[0]);
  return safeReplicateUrl(value);
}

export async function replicatePrediction(token: string, id: string) {
  if (id.startsWith("compositor:")) {
    const baseUrl = process.env.COMPOSITOR_API_URL;
    const secret = process.env.COMPOSITOR_API_SECRET;
    if (!baseUrl || !secret) throw new Error("The controlled compositor connection is unavailable.");
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(id.slice(11))}`, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" } });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error((data.error as string) || "Unable to retrieve the compositor job.");
    return { ...data, status: data.status === "complete" ? "succeeded" : data.status, output: data.output_url || data.output };
  }
  const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
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
  await fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
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
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "respond-async" },
      body: JSON.stringify({
        version: CROSSFADE_VERSION,
        input: {
          task: "composeVideosSeamlessly",
          urls_csv: videos.join(","),
          crossfade_duration: Math.max(0.25, Math.min(2, crossfadeSeconds)),
          fps: 24,
          mute: audioMode === "single_master",
        },
        ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ["completed"] } : {}),
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof data.id !== "string") throw new Error((data.detail as string) || (data.error as string) || "The server could not start crossfade editing.");
    return data.id;
  }
  const size = outputSize(resolution, aspect);
  const response = await fetch("https://api.replicate.com/v1/models/bitflow/video-concat-safe-pro/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "respond-async" },
    body: JSON.stringify({ input: { videos, fps: 24, width: size.width, height: size.height, scale_mode: "crop-fill", mute: false }, ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ["completed"] } : {}) }),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof data.id !== "string") throw new Error((data.detail as string) || (data.error as string) || "The server could not start stitching.");
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
  const historyId = row.id;
  const r2Key = `generation-history/${row.ownerId}/${historyId}.mp4`;
  await env.BUCKET.put(r2Key, upstream.body, { httpMetadata: { contentType: contentType === "application/octet-stream" ? "video/mp4" : contentType } });
  try {
    const now = Date.now();
    const expiresAt = now + 90 * 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(historyId, row.ownerId, r2Key, row.prompt, "studio", row.category, row.resolution, row.aspect, row.duration, row.costCents, sizeBytes, expiresAt, now),
      env.DB.prepare(`UPDATE render_jobs SET status = 'succeeded', history_id = ?, segment_urls = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(historyId, JSON.stringify([source]), now, row.id, row.ownerId),
      env.DB.prepare(`UPDATE projects SET status = 'completed', final_history_id = ?, updated_at = ? WHERE render_job_id = ? AND owner_id = ?`).bind(historyId, now, row.id, row.ownerId),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'delivery', 'Your video is ready', 'The finished video is saved in your project history and ready to download.', NULL, ?)`).bind(`${row.id}:ready`, row.ownerId, now),
    ]);
    await sendAccountEmail(env, row.ownerId, "Your MotionWren video is ready", "Your finished video is saved in your MotionWren dashboard and ready to download.");
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

export async function advanceRenderJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string) {
  if (["succeeded", "failed"].includes(row.status)) return row;
  try {
    if (row.status === "generating") {
      const ids = JSON.parse(row.predictionIds || "[]") as string[];
      const results = await Promise.all(ids.map((predictionId) => replicatePrediction(token, predictionId)));
      const failed = results.find((item) => item.status === "failed" || item.status === "canceled");
      if (failed) {
        await failRenderJob(env, row, String(failed.error || "One video segment failed to generate."));
      } else {
        const urls = results.map((item) => item.status === "succeeded" ? outputUrl(item.output) : null).filter((value): value is string => Boolean(value));
        await env.DB.prepare(`UPDATE render_jobs SET segment_urls = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(urls), Date.now(), row.id).run();
        if (urls.length === ids.length) {
          if (row.kind === "clean-transition" || urls.length === 1) {
            const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
            if (claim.meta.changes) await saveFinishedJob(env, { ...row, status: "saving", segmentUrls: JSON.stringify(urls) }, urls[0]);
          } else {
            const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'stitching', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
            if (claim.meta.changes) {
              const stitchId = await startStitch(token, urls, row.resolution, row.aspect, row.kind === "customer-series" ? 1 : 0, webhookUrl, row.duration);
              await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ?`).bind(stitchId, Date.now(), row.id).run();
            }
          }
        }
      }
    } else if (row.status === "stitching" && !row.stitchPredictionId && Date.now() - row.updatedAt > 2 * 60 * 1000) {
      const urls = JSON.parse(row.segmentUrls || "[]") as string[];
      if (urls.length < 2) throw new Error("The compositor could not recover the generated segments.");
      const claim = await env.DB.prepare(`UPDATE render_jobs SET updated_at = ? WHERE id = ? AND status = 'stitching' AND stitch_prediction_id IS NULL AND updated_at < ?`).bind(Date.now(), row.id, Date.now() - 2 * 60 * 1000).run();
      if (claim.meta.changes) {
        const stitchId = await startStitch(token, urls, row.resolution, row.aspect, row.kind === "customer-series" ? 1 : 0, webhookUrl, row.duration);
        await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ?`).bind(stitchId, Date.now(), row.id).run();
      }
    } else if (row.status === "stitching" && row.stitchPredictionId) {
      const stitch = await replicatePrediction(token, row.stitchPredictionId);
      if (stitch.status === "failed" || stitch.status === "canceled") {
        await failRenderJob(env, row, String(stitch.error || "Server video finishing failed."));
      } else if (stitch.status === "succeeded") {
        const finalUrl = outputUrl(stitch.output);
        if (!finalUrl) throw new Error("The compositor completed without a usable video.");
        await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', segment_urls = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify([finalUrl]), Date.now(), row.id).run();
        await saveFinishedJob(env, { ...row, status: "saving", segmentUrls: JSON.stringify([finalUrl]) }, finalUrl);
      }
    } else if (row.status === "saving" && !row.historyId) {
      const [finalUrl] = JSON.parse(row.segmentUrls || "[]") as string[];
      if (!finalUrl) throw new Error("The finished provider video could not be recovered for storage.");
      await saveFinishedJob(env, row, finalUrl);
    }
  } catch (error) {
    await failRenderJob(env, row, error instanceof Error ? error.message : "The video job could not be completed.");
  }
  return getRenderJob(env, row.id);
}

export function publicJob(row: RenderJobRow) {
  const predictionIds = JSON.parse(row.predictionIds || "[]") as string[];
  const segmentUrls = JSON.parse(row.segmentUrls || "[]") as string[];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.status === "generating" ? `${segmentUrls.length} of ${predictionIds.length} transitions ready` : row.status === "stitching" ? "Joining completed clips on the server" : row.status === "saving" ? "Saving the finished video to History" : row.status === "succeeded" ? "Complete" : row.status === "failed" ? "Stopped" : "Starting",
    completed: segmentUrls.length,
    total: predictionIds.length,
    error: row.error,
    historyId: row.historyId,
    videoUrl: row.historyId ? `/api/history/${row.historyId}/video` : null,
    downloadUrl: row.historyId ? `/api/history/${row.historyId}/video?download=1` : null,
    createdAt: row.createdAt,
  };
}
