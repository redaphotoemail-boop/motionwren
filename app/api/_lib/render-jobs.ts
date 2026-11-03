import { getChatGPTUser } from "../../chatgpt-auth";
import { cookies } from "next/headers";
import { customerSafeError } from "./customer-errors";
import { MAX_ATTEMPTS, STALE_SCENE_MS, deleteFrames, engineInputFor, framesPresent, loadManifest, saveManifest, startProductionScenes, startScene } from "./production";

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
      env.DB.prepare(`UPDATE render_jobs SET status = 'succeeded', history_id = ?, segment_urls = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(historyId, JSON.stringify([source]), now, row.id, row.ownerId),
      env.DB.prepare(`UPDATE projects SET status = 'completed', final_history_id = ?, updated_at = ? WHERE render_job_id = ? AND owner_id = ?`).bind(historyId, now, row.id, row.ownerId),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'delivery', 'Your video is ready', 'The finished video is saved in your project history and ready to download.', NULL, ?)`).bind(`${row.id}:ready`, row.ownerId, now),
    ]);
    await sendAccountEmail(env, row.ownerId, "Your MotionWren video is ready", "Your finished video is saved in your MotionWren dashboard and ready to download.");
    if (manifest) await deleteFrames(env, row.id, manifest.inputs.length); // Studio frames are no longer needed
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
    if (row.status === "starting" && Date.now() - row.updatedAt > 90 * 1000) {
      // The start was cut off (a refresh or dropped connection while the
      // photos were sent or the scenes started): carry on from where it was.
      const manifest = await loadManifest(env, row.id);
      if (!manifest) {
        if (Date.now() - row.updatedAt > 10 * 60 * 1000) throw new Error("The video could not start. Please try again.");
      } else {
        const present = row.kind.startsWith("studio-") ? await framesPresent(env, row.id, manifest.inputs.length) : [];
        if (present.some((value) => !value)) throw new Error("The photos did not finish sending, so nothing was made. Please start again.");
        const claim = await env.DB.prepare(`UPDATE render_jobs SET updated_at = ? WHERE id = ? AND status = 'starting' AND updated_at = ?`).bind(Date.now(), row.id, row.updatedAt).run();
        if (claim.meta.changes) await startProductionScenes(env, token, row.id, manifest, webhookUrl, JSON.parse(row.predictionIds || "[]") as string[]);
      }
    } else if (row.status === "generating") {
      const ids = JSON.parse(row.predictionIds || "[]") as string[];
      const manifest = await loadManifest(env, row.id);
      // A failed status lookup is "try again later", never a failed video.
      const results = await Promise.all(ids.map(async (predictionId) => {
        try { return await replicatePrediction(token, predictionId); }
        catch (error) { return { status: "unknown", error: error instanceof Error ? error.message : "" } as Record<string, unknown>; }
      }));
      const now = Date.now();
      const retry: number[] = [];
      let fatal = "";
      let changed = false;
      results.forEach((item, index) => {
        const status = String(item.status);
        if (status === "succeeded") {
          if (manifest && manifest.states[index] !== "ready") { manifest.states[index] = "ready"; changed = true; }
          return;
        }
        const failed = status === "failed" || status === "canceled";
        const stale = !failed && status !== "unknown" && Boolean(manifest && manifest.startedAt[index] && now - manifest.startedAt[index] > STALE_SCENE_MS);
        if (!failed && !stale) return;
        const message = failed ? String(item.error || "The scene did not finish.") : "The scene took too long and was restarted.";
        if (manifest) { manifest.lastErrors[index] = message.slice(0, 300); changed = true; }
        if (manifest && manifest.attempts[index] < MAX_ATTEMPTS) retry.push(index);
        else if (!fatal) fatal = `Scene ${index + 1} failed${manifest ? ` ${manifest.attempts[index]} times` : ""}: ${message}`;
      });
      if (fatal) {
        await Promise.allSettled(ids.filter((id, index) => !["succeeded", "failed", "canceled"].includes(String(results[index].status)) && !id.startsWith("pending-")).map((id) => cancelProviderJob(token, id)));
        if (manifest) { manifest.states = manifest.states.map((state, index) => results[index].status === "succeeded" ? state : "failed"); await saveManifest(env, row.id, manifest); }
        await failRenderJob(env, row, fatal);
      } else if (retry.length && manifest) {
        // Claim the restart so two webhooks arriving together cannot both start it.
        const claimed = ids.map((id, index) => retry.includes(index) ? `pending-${index}-${now}` : id);
        const claim = await env.DB.prepare(`UPDATE render_jobs SET prediction_ids = ?, updated_at = ? WHERE id = ? AND status = 'generating' AND prediction_ids = ?`).bind(JSON.stringify(claimed), now, row.id, row.predictionIds).run();
        if (claim.meta.changes) {
          const next = [...claimed];
          for (const index of retry) {
            if (!["failed", "canceled"].includes(String(results[index].status))) await cancelProviderJob(token, ids[index]).catch(() => undefined);
            manifest.attempts[index] += 1;
            manifest.startedAt[index] = Date.now();
            manifest.states[index] = "retrying";
            try { next[index] = await startScene(token, manifest.endpoint, await engineInputFor(env, token, row.id, manifest, index, manifest.attempts[index]), webhookUrl); }
            catch (error) { next[index] = ids[index]; manifest.lastErrors[index] = (error instanceof Error ? error.message : "The scene could not restart.").slice(0, 300); }
          }
          await saveManifest(env, row.id, manifest);
          await env.DB.prepare(`UPDATE render_jobs SET prediction_ids = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(next), Date.now(), row.id).run();
        }
      } else {
        if (manifest && changed) await saveManifest(env, row.id, manifest);
        const urls = results.map((item) => item.status === "succeeded" ? outputUrl(item.output) : null).filter((value): value is string => Boolean(value));
        await env.DB.prepare(`UPDATE render_jobs SET segment_urls = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(urls), Date.now(), row.id).run();
        if (urls.length === ids.length) {
          if (row.kind === "clean-transition" || urls.length === 1) {
            const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
            if (claim.meta.changes) await saveFinishedJob(env, { ...row, status: "saving", segmentUrls: JSON.stringify(urls) }, urls[0]).catch(() => undefined); // stays "saving"; retried on the next update
          } else {
            const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'stitching', updated_at = ? WHERE id = ? AND status = 'generating'`).bind(Date.now(), row.id).run();
            if (claim.meta.changes) {
              const stitchId = await startStitch(token, urls, row.resolution, row.aspect, CROSSFADE_KINDS.has(row.kind) ? 1 : 0, webhookUrl, row.duration, manifest?.audio);
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
        const manifest = await loadManifest(env, row.id);
        const stitchId = await startStitch(token, urls, row.resolution, row.aspect, CROSSFADE_KINDS.has(row.kind) ? 1 : 0, webhookUrl, row.duration, manifest?.audio);
        await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ?`).bind(stitchId, Date.now(), row.id).run();
      }
    } else if (row.status === "stitching" && row.stitchPredictionId) {
      let stitch: Record<string, unknown>;
      try { stitch = await replicatePrediction(token, row.stitchPredictionId); }
      catch { return getRenderJob(env, row.id); } // lookup hiccup: check again on the next update
      if (stitch.status === "failed" || stitch.status === "canceled") {
        // Joining is retried twice with the same finished scenes before giving up.
        const manifest = await loadManifest(env, row.id);
        const urls = JSON.parse(row.segmentUrls || "[]") as string[];
        if (manifest && (manifest.stitchAttempts || 0) < 2 && urls.length > 1 && Date.now() - row.createdAt < 50 * 60 * 1000) {
          manifest.stitchAttempts = (manifest.stitchAttempts || 0) + 1;
          await saveManifest(env, row.id, manifest);
          const stitchId = await startStitch(token, urls, row.resolution, row.aspect, CROSSFADE_KINDS.has(row.kind) ? 1 : 0, webhookUrl, row.duration, manifest.audio);
          await env.DB.prepare(`UPDATE render_jobs SET stitch_prediction_id = ?, updated_at = ? WHERE id = ? AND stitch_prediction_id = ?`).bind(stitchId, Date.now(), row.id, row.stitchPredictionId).run();
        } else {
          await failRenderJob(env, row, String(stitch.error || "Server video finishing failed."));
        }
      } else if (stitch.status === "succeeded") {
        const finalUrl = outputUrl(stitch.output);
        if (!finalUrl) throw new Error("The compositor completed without a usable video.");
        await env.DB.prepare(`UPDATE render_jobs SET status = 'saving', segment_urls = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify([finalUrl]), Date.now(), row.id).run();
        await saveFinishedJob(env, { ...row, status: "saving", segmentUrls: JSON.stringify([finalUrl]) }, finalUrl).catch(() => undefined); // retried while "saving"
      }
    } else if (row.status === "saving" && !row.historyId) {
      const [finalUrl] = JSON.parse(row.segmentUrls || "[]") as string[];
      if (!finalUrl) throw new Error("The finished provider video could not be recovered for storage.");
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
  const segmentUrls = JSON.parse(row.segmentUrls || "[]") as string[];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.status === "generating" ? `${segmentUrls.length} of ${predictionIds.length} ${CROSSFADE_KINDS.has(row.kind) || row.kind === "studio-single" ? (predictionIds.length === 1 ? "clip" : "scenes") : "transitions"} ready` : row.status === "stitching" ? "Joining completed clips on the server" : row.status === "saving" ? "Saving the finished video to History" : row.status === "succeeded" ? "Complete" : row.status === "failed" ? "Stopped" : "Starting",
    completed: segmentUrls.length,
    total: predictionIds.length,
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

/* Per-scene states for the loading view (from the job's manifest). */
export async function jobScenes(env: { BUCKET: R2Bucket }, row: RenderJobRow) {
  const manifest = await loadManifest(env, row.id);
  if (!manifest) return null;
  const finishing = ["stitching", "saving", "succeeded"].includes(row.status);
  return manifest.states.map((state, index) => ({ state: finishing ? "ready" : state, attempt: manifest.attempts[index] || 0 }));
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

/* Picks a stopped video back up. Scenes the engine already finished are kept
   when they are still held by the engine (about an hour); the rest are made
   again from the stored photos and settings. Returns how many scenes will be
   made, or why it cannot be picked up. */
export async function resumeRenderJob(env: { DB: D1Database; BUCKET: R2Bucket }, row: RenderJobRow, token: string, webhookUrl?: string): Promise<{ redo: number } | { error: string }> {
  if (row.status !== "failed") return { error: "Only a stopped video can be picked up again." };
  const manifest = await loadManifest(env, row.id);
  if (!manifest) return { error: "This video was made before videos could be picked up again. Please start a new one." };
  if (row.kind.startsWith("studio-") && (await framesPresent(env, row.id, manifest.inputs.length)).some((value) => !value)) return { error: "This video's photos are no longer stored. Please start a new one." };
  const ids = JSON.parse(row.predictionIds || "[]") as string[];
  const keepFinished = Date.now() - row.updatedAt < 45 * 60 * 1000;
  let redo = 0;
  const next = manifest.inputs.map((_, index) => {
    if (keepFinished && manifest.states[index] === "ready" && ids[index] && !ids[index].startsWith("pending-")) return ids[index];
    manifest.attempts[index] = 0;
    manifest.startedAt[index] = Date.now();
    manifest.states[index] = "retrying";
    redo += 1;
    return `resume-${index}`;
  });
  manifest.stitchAttempts = 0;
  await saveManifest(env, row.id, manifest);
  const now = Date.now();
  const claim = await env.DB.prepare(`UPDATE render_jobs SET status = 'generating', prediction_ids = ?, segment_urls = '[]', stitch_prediction_id = NULL, error = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`).bind(JSON.stringify(next), now, row.id).run();
  if (!claim.meta.changes) return { error: "This video changed while it was being picked up. Refresh and try again." };
  await env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE render_job_id = ? AND status IN ('failed', 'cancelled')`).bind(now, row.id).run();
  const fresh = await getRenderJob(env, row.id);
  if (fresh) await advanceRenderJob(env, fresh, token, webhookUrl);
  return { redo };
}
