import { jsonError, requireAdmin } from "../../_lib/account";
import { ACTIVE_STATUSES, advanceStaleJobs, jobScenes, providerNote, publicJob, type RenderJobRow } from "../../_lib/render-jobs";
import { maxActive, readProviderState } from "../../_lib/provider";
import { composerBinding, readEditorState } from "../../_lib/composer";
import { studioEngine } from "../../../engine-catalog";
import { isEngineKey } from "../../../engine-providers";

/* Manager only: production health and every video in production (clients'
   and Studio), with each scene's state, tries, next retry, last provider
   message and engine job ID. PUT changes how many scenes may be with the
   engine at once. Raw provider details never reach customers. */

const COLUMNS = `id, owner_id AS ownerId, kind, status, prediction_ids AS predictionIds, segment_urls AS segmentUrls, stitch_prediction_id AS stitchPredictionId, prompt, category, resolution, aspect, duration, cost_cents AS costCents, error, history_id AS historyId, webhook_token AS webhookToken, created_at AS createdAt, updated_at AS updatedAt`;

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    await advanceStaleJobs(env, new URL(request.url).origin, null, 4).catch(() => 0);
    const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
    const [state, editor, limit, engineRow, rows] = await Promise.all([
      readProviderState(env),
      readEditorState(env),
      maxActive(env),
      env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'defaultEngine'`).first<{ value?: string }>(),
      env.DB.prepare(`SELECT ${COLUMNS} FROM render_jobs WHERE status IN (${placeholders}) OR updated_at > ? ORDER BY created_at DESC LIMIT 30`).bind(...ACTIVE_STATUSES, Date.now() - 24 * 60 * 60 * 1000).all<RenderJobRow>(),
    ]);
    const owners = [...new Set(rows.results.map((row) => row.ownerId))];
    const people = owners.length ? await env.DB.prepare(`SELECT id, email, display_name AS name FROM users WHERE id IN (${owners.map(() => "?").join(",")})`).bind(...owners).all<{ id: string; email: string; name: string }>() : { results: [] };
    const who = new Map(people.results.map((person) => [person.id, person.name || person.email]));
    const jobs = await Promise.all(rows.results.map(async (row) => ({ ...publicJob(row), owner: who.get(row.ownerId) || "", scenes: await jobScenes(env, row) })));
    const scenes = jobs.filter((job) => ACTIVE_STATUSES.includes(job.status as never)).flatMap((job) => job.scenes || []);
    const engine = isEngineKey(engineRow?.value) ? engineRow.value : "wan3";
    return Response.json({
      health: {
        engine: studioEngine(engine).name,
        maxActive: limit,
        activeScenes: scenes.filter((scene) => ["creating", "submitting"].includes(scene.state)).length,
        queuedScenes: scenes.filter((scene) => ["queued", "retry"].includes(scene.state)).length,
        activeVideos: jobs.filter((job) => ACTIVE_STATUSES.includes(job.status as never)).length,
        ...await providerNote(env),
        lastError: state.lastError,
        lastErrorAt: state.lastErrorAt,
        tokenConfigured: Boolean(process.env.REPLICATE_API_TOKEN),
        // The final edit and its music.
        editor: composerBinding(env) ? (editor.lastErrorAt > editor.lastOkAt ? "trouble" : "ready") : "backup",
        editorOkAt: editor.lastOkAt,
        editorError: editor.lastErrorAt > editor.lastOkAt ? editor.lastError : "",
        // What the last film actually used, not just which keys are set.
        music: !process.env.ELEVENLABS_API_KEY ? (process.env.REPLICATE_API_TOKEN ? "Stable Audio (backup)" : "None")
          : editor.musicSource === "stable-audio" ? "Backup in use" : editor.musicSource === "none" ? "Missing" : "ElevenLabs",
        musicNote: editor.musicNote.slice(0, 200),
        polishNote: (editor.polishNote || "").slice(0, 300),
      },
      jobs,
    });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { maxActive?: unknown };
    const value = Number(body.maxActive);
    if (!Number.isInteger(value) || value < 1 || value > 8) return Response.json({ error: "Choose between 1 and 8 scenes at once." }, { status: 400 });
    await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('provider_max_active', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(String(value), Date.now()).run();
    return Response.json({ maxActive: value });
  } catch (error) { return jsonError(error); }
}
