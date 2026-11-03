import { CROSSFADE_SECONDS, MAX_CUSTOMER_SCENES, engineCost, sceneTimingSetting, scenePlan } from "../../../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution, isEngineKey } from "../../../../engine-providers";
import { HttpError, enforceRateLimit, jsonError, requireAccount } from "../../../_lib/account";
import { customerSafeError } from "../../../_lib/customer-errors";
import { musicPrompt } from "../../../_lib/composer";
import { newManifest, saveManifest } from "../../../_lib/production";
import { advanceRenderJob, beginQueue, getRenderJob } from "../../../_lib/render-jobs";

const MOVEMENTS = [
  "a slow stabilized push-in",
  "a slow stabilized lateral slide from left to right",
  "a slow stabilized pull-back",
  "a slow stabilized lateral slide from right to left",
  "a subtle stabilized upward reveal",
  "a subtle stabilized downward reveal",
];
const STATIC_LOCK = "Create an extremely realistic professional real-estate shot. Only the camera moves. Every wall, floor, ceiling, window, door, piece of furniture, decoration, plant, reflection, exterior element and light source remains completely motionless and geometrically identical. Preserve the exact architecture, materials, proportions, perspective and lighting from the source image. Buttery-smooth motorized movement, constant speed, locked horizon, no handheld shake, no walking bounce, no jitter, no flicker, no morphing, no warping, no invented objects, no people entering, no object interaction.";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let jobId: string | null = null;
  let ownerId: string | null = null;
  let projectId: string | null = null;
  try {
    ({ id: projectId } = await context.params);
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    ownerId = account.id;
    await enforceRateLimit(env, account.id, "project-generate", 6, 60 * 60 * 1000);
    const providerToken = process.env.REPLICATE_API_TOKEN;
    if (!providerToken) return Response.json({ error: "Automatic production is not connected yet. The project remains safely submitted for owner production." }, { status: 503 });
    const project = await env.DB.prepare(`SELECT id, title, status, aspect, resolution, target_duration AS targetDuration, render_job_id AS renderJobId FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(projectId, account.id).first<{ id: string; title: string; status: string; aspect: string; resolution: string; targetDuration: number; renderJobId: string | null }>();
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    if (project.renderJobId && ["queued", "generating", "stitching", "saving", "completed"].includes(project.status)) return Response.json({ jobId: project.renderJobId, status: project.status, resumed: true });
    if (!["submitted", "failed"].includes(project.status)) return Response.json({ error: "Submit the project before starting production." }, { status: 409 });
    const assets = await env.DB.prepare(`SELECT id, sort_order AS sortOrder, r2_key AS r2Key FROM project_assets WHERE project_id = ? AND owner_id = ? ORDER BY sort_order, created_at LIMIT 20`).bind(projectId, account.id).all<{ id: string; sortOrder: number; r2Key: string }>();
    if (assets.results.length < 2) return Response.json({ error: "At least two photographs are required." }, { status: 409 });

    // The manager's selected engine (platform_settings defaultEngine); Wan 3.0
    // when unset. Applies to new videos only — jobs already running keep
    // the engine they started with.
    const settingsRow = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'defaultEngine'`).first<{ value?: string }>();
    const rawEngine = settingsRow?.value;
    const engine = isEngineKey(rawEngine) ? rawEngine : "wan3";
    const resolution = engineResolution(engine);

    jobId = crypto.randomUUID();
    const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const origin = new URL(request.url).origin;
    const webhook = `${origin}/api/webhooks/replicate/${jobId}?token=${webhookToken}`;
    const now = Date.now();
    // The video's length decides how many of the customer's photos it uses,
    // in their chosen order (see scenePlan): a 20-second reel uses the first 4.
    const timingRow = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'multi_shot_seconds_per_image'`).first<{ value?: string }>();
    // "3"/"5" fix the scene timing; "auto" and unset choose it by the video's length.
    const plan = scenePlan(engine, resolution, project.targetDuration, Math.min(assets.results.length, MAX_CUSTOMER_SCENES), sceneTimingSetting(timingRow?.value));
    const scenes = assets.results.slice(0, plan.count);
    const sceneSeconds = plan.sceneSeconds;
    const costCents = Math.round(engineCost(engine, resolution, sceneSeconds * scenes.length) * 100);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'customer-series', 'starting', '[]', '[]', NULL, ?, 'real estate', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(jobId, account.id, STATIC_LOCK, resolution, project.aspect, project.targetDuration, costCents, webhookToken, now, now),
      env.DB.prepare(`UPDATE projects SET status = 'queued', generation_engine = ?, resolution = ?, render_job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(engine, resolution, jobId, now, projectId, account.id),
    ]);

    // Every scene's exact request is kept in the job's manifest so a scene
    // that fails or hangs restarts on its own (see production.ts).
    const inputs: Record<string, unknown>[] = [];
    const photos: { key: string; link: string }[] = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const asset = scenes[index];
      const assetToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await env.DB.prepare(`UPDATE project_assets SET provider_token = ? WHERE id = ? AND owner_id = ?`).bind(assetToken, asset.id, account.id).run();
      const imageUrl = `${origin}/api/provider-assets/${asset.id}?token=${assetToken}`;
      photos.push({ key: asset.r2Key, link: imageUrl });
      inputs.push(buildEngineInput(engine, { imageUrl, prompt: `${MOVEMENTS[index % MOVEMENTS.length]}. ${STATIC_LOCK}`, duration: sceneSeconds, resolution, aspectRatio: project.aspect === "vertical" ? "9:16" : "16:9" }));
    }
    // Into the scene queue: scenes are made one after another as the engine
    // allows (waits and retries are automatic); the customer can leave.
    const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, undefined, photos);
    // The final edit: each scene's share on screen and the film's one music track.
    manifest.edit = { shareSeconds: plan.shareSeconds, crossfade: CROSSFADE_SECONDS, music: { prompt: musicPrompt({ aspect: project.aspect, duration: project.targetDuration }) } };
    await saveManifest(env, jobId, manifest);
    if (await beginQueue(env, jobId)) { const queued = await getRenderJob(env, jobId); if (queued) await advanceRenderJob(env, queued, providerToken, webhook); }
    await env.DB.batch([
      env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(Date.now(), projectId, account.id),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'production_started', 'Production started', 'Your photographs are generating now. You can close this page; processing will continue.', NULL, ?)`).bind(`${jobId}:started`, account.id, Date.now()),
    ]);
    return Response.json({ jobId, status: "generating" }, { status: 202 });
  } catch (error) {
    if (jobId && ownerId && projectId) {
      const { env } = await import("cloudflare:workers");
      const message = error instanceof Error ? error.message : "Production could not start.";
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), now, jobId),
        env.DB.prepare(`UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, projectId, ownerId),
        env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'generation_failed', 'Production could not start', ?, NULL, ?)`).bind(`${jobId}:failed`, ownerId, customerSafeError(message).slice(0, 500), now),
      ]);
    }
    // Account and permission errors are shown as-is; anything else in plain words.
    return error instanceof HttpError ? jsonError(error) : Response.json({ error: customerSafeError(error instanceof Error ? error.message : "") }, { status: 500 });
  }
}
