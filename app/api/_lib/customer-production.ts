import { autoQuote } from "../../pricing";
import { CROSSFADE_SECONDS, MAX_CUSTOMER_SCENES, engineCost, engineUpscales, sceneTimingSetting, scenePlan } from "../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution, isEngineKey } from "../../engine-providers";
import { HttpError } from "./account";
import { musicPrompt } from "./composer";
import { musicTemplate } from "../../music-catalog";
import { PHOTO_MOVE_CYCLE, cleanCards, newManifest, saveManifest } from "./production";
import { advanceRenderJob, beginQueue, getRenderJob } from "./render-jobs";
import { alertManagers } from "./scene-queue";
import { guardCheck } from "./spend-guard";
import { planTrueToPhoto, truePicks, truePrompt } from "./true-to-photo";

/* Starts production of a customer's order: plans the scenes from their
   photos, creates the job and puts it in the scene queue. Used by the
   customer's own "generate" call and by the manager's "Start production". */

export const MOVEMENTS = [
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

export async function startOrder(env: Env, project: Project, ownerId: string, origin: string, providerToken: string, opts: { rethrow?: boolean } = {}) {
  if (["queued", "generating", "stitching", "saving", "completed"].includes(project.status)) return { jobId: project.renderJobId || "", status: project.status, resumed: true };
  if (!["submitted", "failed", "approval"].includes(project.status)) throw new HttpError(409, "Submit the project before starting production.");
  const assets = await env.DB.prepare(`SELECT id, sort_order AS sortOrder, r2_key AS r2Key FROM project_assets WHERE project_id = ? AND owner_id = ? ORDER BY sort_order, created_at LIMIT 24`).bind(project.id, ownerId).all<{ id: string; sortOrder: number; r2Key: string }>();
  if (assets.results.length < 2) throw new HttpError(409, "At least two photographs are required.");
  // Automatic length (target 0): each photo is a 5-second scene, so the film is as long as the photos allow.
  const targetSeconds = project.targetDuration || autoQuote(assets.results.length).seconds;
  // Claim the order first: two starts at the same moment (the customer and the manager, or a double tap) make one film, never two.
  const claim = await env.DB.prepare(`UPDATE projects SET status = 'queued', updated_at = ? WHERE id = ? AND owner_id = ? AND status = ?`).bind(Date.now(), project.id, ownerId, project.status).run();
  if (!claim.meta.changes) {
    const current = await loadOrder(env, project.id, ownerId);
    return { jobId: current?.renderJobId || "", status: current?.status || "queued", resumed: true };
  }
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
    const plan = scenePlan(engine, resolution, targetSeconds, Math.min(assets.results.length, MAX_CUSTOMER_SCENES), targetSeconds ? sceneTimingSetting(timingRow?.value) : 5);
    // Every photo the film could use; the walkthrough order below decides which ones it does use.
    const pool = assets.results.slice(0, Math.min(assets.results.length, MAX_CUSTOMER_SCENES));
    const sceneSeconds = plan.sceneSeconds;
    const costCents = Math.round(engineCost(engine, resolution, sceneSeconds * plan.count) * 100);
    const spend = await guardCheck(env, costCents); // the spending guard: at a limit no new film starts (the owner is alerted)
    if (!spend.ok) throw new HttpError(503, "We are not starting new films for a short while. Your order is saved; please try again later.");
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'customer-series', 'starting', '[]', '[]', NULL, ?, 'real estate', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(jobId, ownerId, STATIC_LOCK, resolution, project.aspect, targetSeconds, costCents, webhookToken, now, now),
      env.DB.prepare(`UPDATE projects SET status = 'queued', generation_engine = ?, resolution = ?, render_job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(engine, resolution, jobId, now, project.id, ownerId),
    ]);

    // Every scene's exact request is kept in the job's manifest so a scene
    // that fails or hangs restarts on its own (see production.ts).
    const inputs: Record<string, unknown>[] = [];
    const poolPhotos: { key: string; link: string }[] = [];
    for (let index = 0; index < pool.length; index += 1) {
      const asset = pool[index];
      const assetToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await env.DB.prepare(`UPDATE project_assets SET provider_token = ? WHERE id = ? AND owner_id = ?`).bind(assetToken, asset.id, ownerId).run();
      poolPhotos.push({ key: asset.r2Key, link: `${origin}/api/provider-assets/${asset.id}?token=${assetToken}` });
    }
    // True to the photo (see true-to-photo.ts): each photo is read once, the scenes go in walkthrough order
    // (exterior first), and every scene is a very slow, short push-in that never leaves the photo, so the
    // engine has nothing to invent. The baked lock is kept word for word; the frame lock is added after it.
    // Any trouble keeps the customer's order with centred push-ins; an order never waits on this.
    const trueToPhoto = await planTrueToPhoto(env as unknown as { DB: D1Database } & Record<string, unknown>, project.id, poolPhotos.map((photo) => photo.link)).catch(() => null);
    const order = trueToPhoto && trueToPhoto.order.length === poolPhotos.length ? trueToPhoto.order : poolPhotos.map((_, index) => index);
    const used = order.slice(0, plan.count);
    const photos = used.map((index) => poolPhotos[index]);
    for (const index of used) {
      inputs.push(buildEngineInput(engine, { imageUrl: poolPhotos[index].link, prompt: truePrompt(trueToPhoto?.focus[index] || "center", STATIC_LOCK), duration: sceneSeconds, resolution, aspectRatio: project.aspect === "vertical" ? "9:16" : "16:9" }));
    }
    // Into the scene queue: scenes are made one after another as the engine
    // allows (waits and retries are automatic); the customer can leave.
    const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, undefined, photos);
    // The final edit: each scene's share on screen and the film's one music track.
    if (engine === "photo") manifest.photoMoves = inputs.map((_, index) => PHOTO_MOVE_CYCLE[index % PHOTO_MOVE_CYCLE.length]);
    if (engineUpscales(engine, resolution)) manifest.upscale = { to: "1080p" };
    const cards = await readCardsChoice(env, project.id);
    if (cards) manifest.cards = cards;
    if (trueToPhoto) {
      const plannedPicks = truePicks(trueToPhoto).slice(0, plan.count);
      manifest.movementPlan = { mode: "ai", used: trueToPhoto.reader === "none" ? "opencv" : "ai", picks: plannedPicks, rooms: used.map((index) => trueToPhoto.rooms[index] || ""), costCents: trueToPhoto.costCents, note: `True to the photo. ${trueToPhoto.note}`.trim() };
    }
    manifest.edit = { shareSeconds: plan.shareSeconds, crossfade: CROSSFADE_SECONDS, music: { prompt: musicPrompt({ aspect: project.aspect, duration: targetSeconds, choice: await readMusicChoice(env, project.id) }) } };
    await saveManifest(env, jobId, manifest);
    // The AI photo reader costs a few cents: record it with the film's AI cost so Spend, Finance and the spend limits count it.
    if (trueToPhoto?.costCents) await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS REAL) + CAST(excluded.value AS REAL) AS TEXT), updated_at = excluded.updated_at`).bind(`review-cost:${jobId}`, String(trueToPhoto.costCents), Date.now()).run().catch(() => undefined);
    if (await beginQueue(env, jobId)) { const queued = await getRenderJob(env, jobId); if (queued) await advanceRenderJob(env, queued, providerToken, webhook); }
    await env.DB.batch([
      env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(Date.now(), project.id, ownerId),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'production_started', 'Production started', 'Your photographs are generating now. You can close this page; processing will continue.', NULL, ?)`).bind(`${jobId}:started`, ownerId, Date.now()),
    ]);
  } catch (error) {
    await markStartFailed(env, jobId || null, project.id, ownerId, error, project.title);
    if (opts.rethrow) throw error; // the manager's Start production shows the real reason
    // The customer sees the order as waiting, never as failed; the manager has the real reason.
    return { jobId: "", status: "approval" };
  }
  return { jobId, status: "generating" };
}

/* An order that could not start (the spending limit, an engine refusing,
   anything else) is put back in line for the manager's Start production,
   with the real reason sent to the manager. The customer is told it is in
   line and never that it failed. */
export async function markStartFailed(env: Env, jobId: string | null, projectId: string, ownerId: string, error: unknown, title = "An order") {
  const message = error instanceof Error ? error.message : "Production could not start.";
  const now = Date.now();
  await env.DB.batch([
    ...(jobId ? [env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), now, jobId)] : []),
    env.DB.prepare(`UPDATE projects SET status = 'approval', render_job_id = NULL, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, projectId, ownerId),
    env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'order_received', 'Order received', 'Thanks! Your video goes into production shortly. We will let you know when it is ready.', NULL, ?)`).bind(`${projectId}:waiting`, ownerId, now),
  ]);
  await alertManagers(env, "An order could not start", `"${title}" could not start: ${message.slice(0, 300)}. It is waiting in Orders; press Start production when ready.`);
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

export const dropMusicChoiceStatement = (env: { DB: D1Database }, projectId: string) => env.DB.prepare(`DELETE FROM platform_settings WHERE key IN (?, ?)`).bind(musicChoiceKey(projectId), cardsKey(projectId));

/* The listing and agent cards the customer typed in the plan, kept per order the same way (a platform_settings row).
   The editor burns them into the film: the address and price open it, the agent closes it. */
const cardsKey = (projectId: string) => `project_cards:${projectId}`;

export async function saveCardsChoice(env: { DB: D1Database }, projectId: string, value: unknown) {
  const cards = cleanCards(value);
  if (!cards) return null;
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(cardsKey(projectId), JSON.stringify(cards), Date.now()).run();
  return cards;
}

export async function readCardsChoice(env: { DB: D1Database }, projectId: string) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(cardsKey(projectId)).first<{ value?: string }>();
  try { return row?.value ? cleanCards(JSON.parse(row.value)) : undefined; } catch { return undefined; }
}
