import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicJob, safeReplicateUrl, startStitch, type RenderJobRow } from "../_lib/render-jobs";
import { jsonError, requireAdmin } from "../_lib/account";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const store = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || store.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "Reconnect Replicate before stitching." }, { status: 503 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const videos = Array.isArray(body.videos) ? body.videos.map(safeReplicateUrl).filter((value): value is string => Boolean(value)) : [];
    if (videos.length < 2 || videos.length > 12) return NextResponse.json({ error: "Between 2 and 12 completed provider clips are required." }, { status: 400 });
    const resolution = body.resolution === "1080p" ? "1080p" : "720p";
    const aspect = typeof body.aspect === "string" ? body.aspect.slice(0, 20) : "horizontal";
    const crossfadeSeconds = Math.max(0.25, Math.min(2, Number(body.crossfadeSeconds) || 0.75));
    const duration = Math.max(1, Math.min(600, Math.round(Number(body.duration) || videos.length * 5)));
    const costCents = Math.max(0, Math.min(100000, Math.round(Number(body.costCents) || 0)));
    const id = crypto.randomUUID(); const now = Date.now();
    const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const webhook = `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${webhookToken}`;
    const audioMode = body.audioMode === "single_master" ? "single_master" : "silent";
    const audioDirection = typeof body.audioDirection === "string" ? body.audioDirection : "";
    const voiceoverScript = typeof body.voiceoverScript === "string" ? body.voiceoverScript : "";
    const stitchId = await startStitch(token, videos, resolution, aspect, crossfadeSeconds, webhook, duration, { mode: audioMode, direction: audioDirection, voiceoverScript });
    const prompt = typeof body.prompt === "string" ? `${body.prompt.slice(0, 5600)} True visual crossfades: ${crossfadeSeconds.toFixed(2)} seconds. Audio policy: ${audioMode === "single_master" ? "one continuous master track across the complete series; never preserve separate scene music" : "silent scene mix"}.` : `Complete stabilized multi-shot series with ${crossfadeSeconds.toFixed(2)}-second visual crossfades. Audio policy: ${audioMode}.`;
    const category = typeof body.category === "string" ? body.category.slice(0, 60) : "stitched series";
    await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'series-stitch', 'stitching', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(id, ownerId, JSON.stringify([]), JSON.stringify(videos), stitchId, prompt, category, resolution, aspect, duration, costCents, webhookToken, now, now).run();
    const row = await env.DB.prepare(`SELECT id, owner_id AS ownerId, kind, status, prediction_ids AS predictionIds, segment_urls AS segmentUrls, stitch_prediction_id AS stitchPredictionId, prompt, category, resolution, aspect, duration, cost_cents AS costCents, error, history_id AS historyId, webhook_token AS webhookToken, created_at AS createdAt, updated_at AS updatedAt FROM render_jobs WHERE id = ?`).bind(id).first<RenderJobRow>();
    return NextResponse.json({ job: row ? publicJob(row) : { id, status: "stitching" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server stitching could not start." }, { status: 500 });
  }
}
