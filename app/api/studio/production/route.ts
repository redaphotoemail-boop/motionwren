import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { engineCost, engineDurationOptions, preferredDurationForEngine, scenePlan, studioEngine, VIDEO_LENGTHS, type StudioResolution } from "../../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, isEngineKey } from "../../../engine-providers";
import { getRenderJob, publicJob } from "../../_lib/render-jobs";
import { newManifest, saveManifest, startProductionScenes, storeFrame } from "../../_lib/production";
import { studioToken } from "../../_lib/studio-token";

/* Studio production on the server — the same path client videos take.
   1. POST here with the settings and each scene's prompt: the job is created
      (nothing is made or charged yet) and the plan comes back.
   2. PUT /api/studio/production/{id}?scene=N with each scene's photo.
   3. POST /api/studio/production/{id} to start.
   Every step is small and quick, and if the page is refreshed after the
   photos are in, the server starts the film on its own. Failed scenes are
   made again automatically and the finished film is saved to History.
   mode "single": one clip of clipSeconds. mode "series": a film of 15, 30
   or 60 seconds built from the first photos the length needs.
   (An older Studio page that still sends the photos inline in step 1 is
   started straight away, as before.) */

type SceneBody = { image?: unknown; prompt?: unknown; audio?: unknown };
const MAX_INLINE_FRAME = 1_500_000;

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const token = await studioToken();
  if (!token) return NextResponse.json({ error: "The video engine is not connected yet." }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const mode = body.mode === "single" ? "single" : "series";
  const engine = isEngineKey(body.engine) ? body.engine : "wan3";
  const supported = studioEngine(engine).resolutions;
  const resolution: StudioResolution = supported.includes(body.resolution as StudioResolution) ? body.resolution as StudioResolution : supported[supported.length - 1];
  const aspect = body.aspect === "vertical" ? "vertical" : body.aspect === "cinematic" ? "cinematic" : "horizontal";
  const scenesIn = Array.isArray(body.scenes) ? body.scenes as SceneBody[] : [];
  const inline = scenesIn.length > 0 && scenesIn.every((scene) => typeof scene.image === "string");
  const valid = scenesIn.filter((scene) => typeof scene.prompt === "string" && scene.prompt.trim().length >= 20 && (!inline || (String(scene.image).startsWith("data:image/") && String(scene.image).length <= MAX_INLINE_FRAME)));
  if (valid.length !== scenesIn.length || !valid.length || valid.length > 12) return NextResponse.json({ error: "Every scene needs a clear prompt (and at most 12 scenes)." }, { status: 400 });
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
  const now = Date.now();
  const kind = mode === "single" ? "studio-single" : "studio-series";
  // The job exists before anything starts, so early callbacks find it.
  await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, ?, 'starting', '[]', '[]', NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
    .bind(id, ownerId, kind, String(scenes[0].prompt).slice(0, 6000), `Studio · ${label}`, resolution, aspect, duration, costCents, webhookToken, now, now).run();
  const inputs = scenes.map((scene, index) => buildEngineInput(engine, {
    imageUrl: `${origin}/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg?token=${webhookToken}`,
    prompt: String(scene.prompt), duration: sceneSeconds, resolution, aspectRatio: aspect === "vertical" ? "9:16" : "16:9",
    audio: scene.audio === true, seed: seed === undefined ? undefined : seed + index,
  }));
  // One soundtrack across the joined film (when the scenes have sound), never a different track per scene.
  const audio = mode === "series" && body.audioMode === "single_master" ? { mode: "single_master" as const, direction: typeof body.audioDirection === "string" ? body.audioDirection.slice(0, 1200) : "", voiceoverScript: typeof body.voiceoverScript === "string" ? body.voiceoverScript.slice(0, 2000) : "" } : undefined;
  const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, audio);
  try {
    if (inline) {
      for (let index = 0; index < scenes.length; index += 1) await storeFrame(env, id, index, String(scenes[index].image));
      await startProductionScenes(env, token, id, manifest, `${origin}/api/webhooks/replicate/${id}?token=${webhookToken}`);
    } else {
      await saveManifest(env, id, manifest);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The video could not start.";
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), Date.now(), id).run();
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const row = await getRenderJob(env, id);
  return NextResponse.json({ job: row ? { ...publicJob(row), scenes: scenes.map(() => ({ state: "waiting", attempt: 0 })) } : { id, status: "starting" }, plan: { count: scenes.length, sceneSeconds, duration, costCents } });
}
