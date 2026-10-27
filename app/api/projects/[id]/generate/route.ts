import { engineCost, preferredDurationForEngine } from "../../../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution, isEngineKey } from "../../../../engine-providers";
import { enforceRateLimit, jsonError, requireAccount } from "../../../_lib/account";
import { customerSafeError } from "../../../_lib/customer-errors";

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
  const started: string[] = [];
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
    const assets = await env.DB.prepare(`SELECT id, sort_order AS sortOrder FROM project_assets WHERE project_id = ? AND owner_id = ? ORDER BY sort_order, created_at LIMIT 12`).bind(projectId, account.id).all<{ id: string; sortOrder: number }>();
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
    const requestedSceneSeconds = Math.max(3, Math.min(10, Math.round((project.targetDuration + assets.results.length - 1) / assets.results.length)));
    const sceneSeconds = preferredDurationForEngine(engine, requestedSceneSeconds, resolution);
    const costCents = Math.round(engineCost(engine, resolution, sceneSeconds * assets.results.length) * 100);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'customer-series', 'starting', '[]', '[]', NULL, ?, 'real estate', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(jobId, account.id, STATIC_LOCK, resolution, project.aspect, project.targetDuration, costCents, webhookToken, now, now),
      env.DB.prepare(`UPDATE projects SET status = 'queued', generation_engine = ?, resolution = ?, render_job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(engine, resolution, jobId, now, projectId, account.id),
    ]);

    for (let index = 0; index < assets.results.length; index += 1) {
      const asset = assets.results[index];
      const assetToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await env.DB.prepare(`UPDATE project_assets SET provider_token = ? WHERE id = ? AND owner_id = ?`).bind(assetToken, asset.id, account.id).run();
      const imageUrl = `${origin}/api/provider-assets/${asset.id}?token=${assetToken}`;
      const response = await fetch(ENGINE_ENDPOINTS[engine], {
        method: "POST",
        headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ input: buildEngineInput(engine, { imageUrl, prompt: `${MOVEMENTS[index % MOVEMENTS.length]}. ${STATIC_LOCK}`, duration: sceneSeconds, resolution, aspectRatio: project.aspect === "vertical" ? "9:16" : "16:9" }), webhook, webhook_events_filter: ["completed"] }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok || typeof data.id !== "string") throw new Error(customerSafeError((data.detail as string) || (data.error as string) || `Scene ${index + 1} could not start.`));
      started.push(data.id);
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE render_jobs SET status = 'generating', prediction_ids = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(started), Date.now(), jobId),
      env.DB.prepare(`UPDATE projects SET status = 'generating', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(Date.now(), projectId, account.id),
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'production_started', 'Production started', 'Your photographs are generating now. You can close this page; processing will continue.', NULL, ?)`).bind(`${jobId}:started`, account.id, Date.now()),
    ]);
    return Response.json({ jobId, status: "generating" }, { status: 202 });
  } catch (error) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (token) await Promise.allSettled(started.map((id) => fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })));
    if (jobId && ownerId && projectId) {
      const { env } = await import("cloudflare:workers");
      const message = error instanceof Error ? error.message : "Production could not start.";
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), now, jobId),
        env.DB.prepare(`UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, projectId, ownerId),
        env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'generation_failed', 'Production could not start', ?, NULL, ?)`).bind(`${jobId}:failed`, ownerId, message.slice(0, 500), now),
      ]);
    }
    return jsonError(error);
  }
}
