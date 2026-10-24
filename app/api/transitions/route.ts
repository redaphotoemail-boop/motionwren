import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_STATUSES, publicJob, type RenderJobRow } from "../_lib/render-jobs";
import { jsonError, requireAdmin } from "../_lib/account";

const AI_ENDPOINT = "https://api.replicate.com/v1/models/wan-video/wan-2.7-i2v/predictions";
const CLEAN_ENDPOINT = "https://api.replicate.com/v1/models/lucataco/image-to-video-slideshow/predictions";

function validFrame(value: unknown) {
  return typeof value === "string" && value.startsWith("data:image/") && value.length <= 1_500_000;
}

export async function GET() {
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
  const row = await env.DB.prepare(`SELECT id, owner_id AS ownerId, kind, status, prediction_ids AS predictionIds, segment_urls AS segmentUrls, stitch_prediction_id AS stitchPredictionId, prompt, category, resolution, aspect, duration, cost_cents AS costCents, error, history_id AS historyId, created_at AS createdAt, updated_at AS updatedAt FROM render_jobs WHERE owner_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`).bind(ownerId, ...ACTIVE_STATUSES).first<RenderJobRow>();
  return NextResponse.json({ job: row ? publicJob(row) : null });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const store = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || store.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "Connect Replicate before generating." }, { status: 503 });
  const startedIds: string[] = [];
  try {
    const id = crypto.randomUUID();
    const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const webhook = `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${webhookToken}`;
    const body = await request.json() as Record<string, unknown>;
    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length < 2 || images.length > 8 || !images.every(validFrame)) return NextResponse.json({ error: "Add between 2 and 8 valid frames." }, { status: 400 });
    const mode = body.mode === "clean" ? "clean" : "ai";
    const requestedResolution = body.resolution === "1080p" ? "1080p" : "720p";
    const durationPerTransition = body.duration === 10 ? 10 : 5;
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6000) : "";
    if (mode === "ai" && prompt.length < 20) return NextResponse.json({ error: "A clear movement direction is required." }, { status: 400 });
    const seed = Number.isInteger(body.seed) && Number(body.seed) >= 0 ? Number(body.seed) : undefined;
    const negativePrompt = "people entering, hands touching objects, object interaction, independent object movement, subject movement, morphing, warping, melting, duplication, replacement, invented objects, new elements, disappearing objects, geometry changes, material changes, text changes, lighting changes, flicker, shake, jitter, handheld motion, walking bounce, cuts, surreal action";

    if (mode === "clean") {
      const response = await fetch(CLEAN_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ input: { images, duration_per_image: durationPerTransition, resolution: requestedResolution, aspect_ratio: body.aspect === "vertical" ? "9:16" : body.aspect === "cinematic" ? "21:9" : "16:9", transition_type: "fade", frame_rate: 30 }, webhook, webhook_events_filter: ["completed"] }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok || typeof data.id !== "string") throw new Error((data.detail as string) || (data.error as string) || "The clean transition could not start.");
      startedIds.push(data.id);
    } else {
      for (let index = 0; index < images.length - 1; index += 1) {
        const response = await fetch(AI_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "respond-async" },
          body: JSON.stringify({ input: { first_frame: images[index], last_frame: images[index + 1], prompt, negative_prompt: negativePrompt, resolution: requestedResolution, duration: durationPerTransition, enable_prompt_expansion: false, ...(seed === undefined ? {} : { seed: seed + index }) }, webhook, webhook_events_filter: ["completed"] }),
        });
        const data = await response.json() as Record<string, unknown>;
        if (!response.ok || typeof data.id !== "string") throw new Error((data.detail as string) || (data.error as string) || `Transition ${index + 1} could not start.`);
        startedIds.push(data.id);
      }
    }

    const now = Date.now();
    const pairCount = images.length - 1;
    const duration = mode === "clean" ? images.length * durationPerTransition : pairCount * durationPerTransition;
    const costCents = mode === "clean" ? 1 : Math.round(duration * 15);
    await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(id, ownerId, mode === "clean" ? "clean-transition" : "ai-transition", "generating", JSON.stringify(startedIds), "[]", prompt, `${images.length}-frame ${mode === "clean" ? "clean dissolve" : "controlled transition"}`, requestedResolution, typeof body.aspect === "string" ? body.aspect.slice(0, 20) : "horizontal", duration, costCents, webhookToken, now, now).run();
    const row = await env.DB.prepare(`SELECT id, owner_id AS ownerId, kind, status, prediction_ids AS predictionIds, segment_urls AS segmentUrls, stitch_prediction_id AS stitchPredictionId, prompt, category, resolution, aspect, duration, cost_cents AS costCents, error, history_id AS historyId, webhook_token AS webhookToken, created_at AS createdAt, updated_at AS updatedAt FROM render_jobs WHERE id = ?`).bind(id).first<RenderJobRow>();
    return NextResponse.json({ job: row ? publicJob(row) : { id, status: "generating" } });
  } catch (error) {
    await Promise.allSettled(startedIds.map((id) => fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })));
    return NextResponse.json({ error: error instanceof Error ? error.message : "The transition job could not be started." }, { status: 500 });
  }
}
