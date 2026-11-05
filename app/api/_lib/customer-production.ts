import { CROSSFADE_SECONDS, MAX_CUSTOMER_SCENES, engineCost, engineUpscales, sceneTimingSetting, scenePlan } from "../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution, isEngineKey } from "../../engine-providers";
import { HttpError } from "./account";
import { customerSafeError } from "./customer-errors";
import { musicPrompt } from "./composer";
import { musicTemplate } from "../../music-catalog";
import { PHOTO_MOVE_CYCLE, newManifest, saveManifest } from "./production";
import { advanceRenderJob, beginQueue, getRenderJob } from "./render-jobs";
import { alertManagers } from "./scene-queue";

/* Starts production of a customer's order: plans the scenes from their
   photos, creates the job and puts it in the scene queue. Used by the
   customer's own "generate" call and by the manager's "Start production". */

const MOVEMENTS = [
  "a slow stabilized push-in",
  "a slow stabilized lateral slide from left to right",
  "a slow stabilized pull-back",
  "a slow stabilized lateral slide from right to left",
  "a subtle stabilized upward reveal",
  "a subtle stabilized downward reveal",
];
export const STATIC_LOCK = "Create an extremely realistic professional real-estate shot. Only the camera moves. Every wall, floor, ceiling, window, door, piece of furniture, decoration, plant, reflection, exterior element and light source remains completely motionless and geometrically identical. Preserve the exact architecture, materials, proportions, perspective and lighting from the source image. Buttery-smooth motorized movement, constant speed, locked horizon, no handheld shake, no walking bounce, no jitter, no flicker, no morphing, no warping, no invented objects, no people entering, no object interaction.";

type Env = { DB: D1Database; BUCKET: R2Bucket };
type Project = { id: string; title: string; status: string; aspect: string; resolution: string; targetDuration: number; renderJobId: string | null };

export async function loadOrder(env: Env, projectId: string, ownerId: string) {
  return env.DB.prepare(`SELECT id, title, status, aspect, resolution, target_duration AS targetDuration, render_job_id AS renderJobId FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(projectId, ownerId).first<Project>();
}

/* Orders wait for the manager's OK while payments are not connected (so no
   unpaid order spends engine money), unless the manager switched customer
   production to automatic. */
export async function needsApproval(env: Env, role: string) {
  if (role === "admin" || process.env.STRIPE_SECRET_KEY) return false;
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'customer_production'`).first<{ value?: string }>();
  return row?.value !== "automatic";
}

export async function holdForApproval(env: Env, project: Project, ownerId: string) {
  const now = Date.now();
  const held = await env.DB.prepare(`UPDATE projects SET status = 'approval', updated_at = ? WHERE id = ? AND owner_id = ? AND status IN ('submitted', 'failed')`).bind(now, project.id, ownerId).run();
  if (held.meta.changes) {
    await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'order_received', 'Order received', 'Thanks! Your video goes into production shortly. We will let you know when it is ready.', NULL, ?)`).bind(`${project.id}:received:${now}`, ownerId, now).run();
    await alertManagers(env, "New order to start", `"${project.title}" is waiting for you. Open Orders and press Start production.`);
  }
  return { status: "approval" as const };
}

export async function startOrder(env: Env, project: Project, ownerId: string, origin: string, providerToken: string) {
  if (project.renderJobId && ["queued", "generating", "stitching", "saving", "completed"].includes(project.status)) return { jobId: project.renderJobId, status: project.status, resumed: true };
  if (!["submitted", "failed", "approval"].includes(project.status)) throw new HttpError(409, "Submit the project before starting production.");
  const assets = await env.DB.prepare(`SELECT id, sort_order AS sortOrder, r2_key AS r2Key FROM project_assets WHERE project_id = ? AND owner_id = ? ORDER BY sort_order, created_at LIMIT 20`).bind(project.id, ownerId).all<{ id: string; sortOrder: number; r2Key: string }>();
  if (assets.results.length < 2) throw new HttpError(409, "At least two photographs are required.");
  let jobId = "";
  try {
    // The manager's selected engine (platform_settings defaultEngine); Wan 3.0
    // when unset. Applies to new videos only — jobs already running keep
    // the engine they started with.
    const settingsRow = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'defaultEngine'`).first<{ value?: string }>();
    const rawEngine = settingsRow?.value;
    const engine = isEngineKey(rawEngine) ? rawEngine : "wan3";
    const resolution = engineResolution(engine);

    jobId = crypto.randomUUID();
    const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
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
      env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'customer-series', 'starting', '[]', '[]', NULL, ?, 'real estate', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(jobId, ownerId, STATIC_LOCK, resolution, project.aspect, project.targetDuration, costCents, webhookToken, now, now),
      env.DB.prepare(`UPDATE projects SET status = 'queued', generation_engine = ?, resolution = ?, render_job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(engine, resolution, jobId, now, project.id, ownerId),
    ]);

    // Every scene's exact request is kept in the job's manifest so a scene
    // that fails or hangs restarts on its own (see production.ts).
    const inputs: Record<string, unknown>[] = [];
    const photos: { key: string; link: string }[] = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const asset = scenes[index];
      const assetToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await env.DB.prepare(`UPDATE project_assets SET provider_token = ? WHERE id = ? AND owner_id = ?`).bind(assetToken, asset.id, ownerId).run();
      const imageUrl = `${origin}/api/provider-assets/${asset.id}?token=${assetToken}`;
      photos.push({ key: asset.r2Key, link: imageUrl });
      inputs.push(buildEngineInput(engine, { imageUrl, prompt: `${MOVEMENTS[index % MOVEMENTS.length]}. ${STATIC_LOCK}`, duration: sceneSeconds, resolution, aspectRatio: project.aspect === "vertical" ? "9:16" : "16:9" }));
    }
    // Into the scene queue: scenes are made one after another as the engine
    // allows (waits and retries are automatic); the customer can leave.
    const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, undefined, photos);
    // The final edit: each scene's share on screen and the film's one music track.
    if (engine === "photo") manifest.photoMoves = inputs.map((_, index) => PHOTO_MOVE_CYCLE[index % PHOTO_MOVE_CYCLE.length]);
    if (engineUpscales(engine, resolution)) manifest.upscale = { to: "1080p" };
    manifest.edit = { shareSeconds: plan.shareSeconds, crossfade: CROSSFADE_SECONDS, music: { prompt: musicPrompt({ aspect: project.aspect, duration: project.targetDuration, choice: await readMusicChoice(env, project.id) }) } };
    await saveManifest(env, jobId, manifest);
    if (await beginQueue(env, jobId)) { const queued = await getRenderJob(env, jobId); if (queued) await advanceRenderJob(env, queued, providerToken, webhook); }
    await env.DB.batch([
      env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(Date.now(), project.id, ownerId),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'production_started', 'Production started', 'Your photographs are generating now. You can close this page; processing will continue.', NULL, ?)`).bind(`${jobId}:started`, ownerId, Date.now()),
    ]);
  } catch (error) {
    if (jobId) await markStartFailed(env, jobId, project.id, ownerId, error);
    throw error;
  }
  return { jobId, status: "generating" };
}

export async function markStartFailed(env: Env, jobId: string, projectId: string, ownerId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Production could not start.";
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), now, jobId),
    env.DB.prepare(`UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, projectId, ownerId),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'generation_failed', 'Production could not start', ?, NULL, ?)`).bind(`${jobId}:failed`, ownerId, customerSafeError(message).slice(0, 500), now),
  ]);
}

/* The music template the customer chose in the plan, kept per order (no
   schema change: a platform_settings row). Without one, the film's music is
   matched to its shape (musicPrompt). */
const musicChoiceKey = (projectId: string) => `project_music:${projectId}`;

export async function saveMusicChoice(env: { DB: D1Database }, projectId: string, choice: unknown) {
  const template = musicTemplate(choice);
  if (!template) return null;
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(musicChoiceKey(projectId), template.id, Date.now()).run();
  return template.id;
}

export async function readMusicChoice(env: { DB: D1Database }, projectId: string) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(musicChoiceKey(projectId)).first<{ value?: string }>();
  return musicTemplate(row?.value)?.id || null;
}

export const dropMusicChoiceStatement = (env: { DB: D1Database }, projectId: string) => env.DB.prepare(`DELETE FROM platform_settings WHERE key = ?`).bind(musicChoiceKey(projectId));
