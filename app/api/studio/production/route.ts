import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { engineCost, engineDurationOptions, preferredDurationForEngine, scenePlan, studioEngine, VIDEO_LENGTHS, type StudioResolution } from "../../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, isEngineKey } from "../../../engine-providers";
import { publicJob, type RenderJobRow } from "../../_lib/render-jobs";
import { newManifest, startProductionScenes, storeFrame } from "../../_lib/production";

/* Studio production on the server — the same path customer videos take.
   The owner's photos and prompts are stored, the engine is started with
   callbacks, failed scenes restart on their own, and the finished film is
   joined and saved to History even if the Studio tab is closed or refreshed.
   mode "single": one clip of clipSeconds. mode "series": a film of 15, 30
   or 60 seconds built from the first photos the length needs. */

type SceneBody = { image?: unknown; prompt?: unknown; audio?: unknown };
const MAX_FRAME = 1_500_000;

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return NextResponse.json({ error: "The video engine is not connected on the server yet." }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const mode = body.mode === "single" ? "single" : "series";
  const engine = isEngineKey(body.engine) ? body.engine : "wan3";
  const supported = studioEngine(engine).resolutions;
  const resolution: StudioResolution = supported.includes(body.resolution as StudioResolution) ? body.resolution as StudioResolution : supported[supported.length - 1];
  const aspect = body.aspect === "vertical" ? "vertical" : body.aspect === "cinematic" ? "cinematic" : "horizontal";
  const scenesIn = Array.isArray(body.scenes) ? body.scenes as SceneBody[] : [];
  const valid = scenesIn.filter((scene) => typeof scene.image === "string" && scene.image.startsWith("data:image/") && scene.image.length <= MAX_FRAME && typeof scene.prompt === "string" && scene.prompt.trim().length >= 20);
  if (valid.length !== scenesIn.length || !valid.length) return NextResponse.json({ error: "Every scene needs an image (under 1.5 MB prepared) and a clear prompt." }, { status: 400 });
  if (mode === "series" && valid.length < 2) return NextResponse.json({ error: "Add at least two scenes." }, { status: 400 });

  // How many scenes and how long each, so the film lands on the chosen length.
  let count = 1, sceneSeconds: number, duration: number;
  if (mode === "single") {
    sceneSeconds = preferredDurationForEngine(engine, Math.max(3, Math.min(15, Math.round(Number(body.clipSeconds) || 5))), resolution);
    duration = sceneSeconds;
  } else {
    const length = VIDEO_LENGTHS.includes(Number(body.length) as (typeof VIDEO_LENGTHS)[number]) ? Number(body.length) : 30;
    const timingRow = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'multi_shot_seconds_per_image'`).first<{ value?: string }>();
    const plan = scenePlan(engine, resolution, length, valid.length, timingRow?.value === "3" ? 3 : 5);
    count = plan.count; sceneSeconds = plan.sceneSeconds; duration = plan.totalSeconds;
  }
  if (!engineDurationOptions(engine, resolution).includes(sceneSeconds as never)) return NextResponse.json({ error: "This engine cannot make scenes of that length." }, { status: 400 });
  const scenes = valid.slice(0, count);
  const seed = Number.isInteger(body.seed) && Number(body.seed) >= 0 ? Number(body.seed) : undefined;
  const costCents = Math.round(engineCost(engine, resolution, sceneSeconds * scenes.length) * 100);
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : mode === "single" ? "Single clip" : `${duration}-second film`;

  const id = crypto.randomUUID();
  const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const origin = new URL(request.url).origin;
  const webhook = `${origin}/api/webhooks/replicate/${id}?token=${webhookToken}`;
  const now = Date.now();
  const kind = mode === "single" ? "studio-single" : "studio-series";
  // The job exists before anything starts, so early callbacks find it.
  await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, ?, 'starting', '[]', '[]', NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
    .bind(id, ownerId, kind, String(scenes[0].prompt).slice(0, 6000), `Studio · ${label}`, resolution, aspect, duration, costCents, webhookToken, now, now).run();
  try {
    const inputs: Record<string, unknown>[] = [];
    for (let index = 0; index < scenes.length; index += 1) {
      await storeFrame(env, id, index, String(scenes[index].image));
      const imageUrl = `${origin}/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg?token=${webhookToken}`;
      inputs.push(buildEngineInput(engine, { imageUrl, prompt: String(scenes[index].prompt), duration: sceneSeconds, resolution, aspectRatio: aspect === "vertical" ? "9:16" : "16:9", audio: scenes[index].audio === true, seed: seed === undefined ? undefined : seed + index }));
    }
    // One soundtrack across the joined film (when the scenes have sound), never a different track per scene.
    const audio = mode === "series" && (body.audioMode === "single_master") ? { mode: "single_master" as const, direction: typeof body.audioDirection === "string" ? body.audioDirection.slice(0, 1200) : "", voiceoverScript: typeof body.voiceoverScript === "string" ? body.voiceoverScript.slice(0, 2000) : "" } : undefined;
    await startProductionScenes(env, token, id, newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, audio), webhook);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The video could not start.";
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), Date.now(), id).run();
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const row = await env.DB.prepare(`SELECT id, owner_id AS ownerId, kind, status, prediction_ids AS predictionIds, segment_urls AS segmentUrls, stitch_prediction_id AS stitchPredictionId, prompt, category, resolution, aspect, duration, cost_cents AS costCents, error, history_id AS historyId, webhook_token AS webhookToken, created_at AS createdAt, updated_at AS updatedAt FROM render_jobs WHERE id = ?`).bind(id).first<RenderJobRow>();
  return NextResponse.json({ job: row ? { ...publicJob(row), scenes: scenes.map(() => ({ state: "creating", attempt: 1 })) } : { id, status: "generating" }, plan: { count: scenes.length, sceneSeconds, duration, costCents } });
}
