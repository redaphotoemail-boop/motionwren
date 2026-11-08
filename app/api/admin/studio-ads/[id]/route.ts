/* Studio Ads: one ad (with its images, actors and job state) / delete it. Admin only. */
import { jsonError, requireAdmin } from "../../../_lib/account";
import { adJobState, loadAd } from "../../../_lib/ads-production";
import { adMusicMood } from "../../../../ads-music-catalog";
import { AD_DURATIONS } from "../../../../ads-creative";
import { isEngineKey } from "../../../../engine-providers";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const ad = await loadAd(env, id, admin.id);
    if (!ad) return Response.json({ error: "Ad not found." }, { status: 404 });
    const assets = await env.DB.prepare(`SELECT id, kind, r2_key AS r2Key, file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes, sort_order AS sortOrder, created_at AS createdAt FROM ad_assets WHERE ad_project_id = ? AND owner_id = ? ORDER BY sort_order, created_at`).bind(id, admin.id).all();
    const actors = await env.DB.prepare(`SELECT a.id, a.name, a.notes FROM ad_actors a JOIN ad_project_actors l ON l.actor_id = a.id WHERE l.ad_project_id = ? AND a.owner_id = ? ORDER BY a.name`).bind(id, admin.id).all<{ id: string; name: string; notes: string }>();
    const actorList = [];
    for (const actor of actors.results || []) {
      const photos = await env.DB.prepare(`SELECT id, angle, file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes, sort_order AS sortOrder, created_at AS createdAt FROM ad_actor_photos WHERE actor_id = ? AND owner_id = ? ORDER BY sort_order, created_at`).bind(actor.id, admin.id).all();
      actorList.push({ ...actor, photos: photos.results || [] });
    }
    const job = await adJobState(env, ad, admin.id);
    return Response.json({
      ad,
      assets: assets.results || [],
      actors: actorList,
      job,
      downloadUrl: ad.finalHistoryId ? `/api/history/${ad.finalHistoryId}/video?download=1` : null,
    });
  } catch (error) { return jsonError(error); }
}

/* Update an ad's brief (draft or failed only — never while it is being made). */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const ad = await loadAd(env, id, admin.id);
    if (!ad) return Response.json({ error: "Ad not found." }, { status: 404 });
    if (!["draft", "failed"].includes(ad.status)) return Response.json({ error: "This ad is being made. Wait for it to finish before changing it." }, { status: 409 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const str = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
    const title = str(body.title, 120);
    if (title.length < 2) return Response.json({ error: "Give the ad a title (at least 2 characters)." }, { status: 400 });
    const engine = isEngineKey(body.engine) ? body.engine : ad.engine;
    const aspect = body.aspect === "horizontal" || body.aspect === "square" ? body.aspect : body.aspect === "vertical" ? "vertical" : ad.aspect;
    const targetDuration = (AD_DURATIONS as readonly number[]).includes(Number(body.targetDuration)) ? Number(body.targetDuration) : ad.targetDuration;
    const subtitles = (body.subtitles && typeof body.subtitles === "object" && !Array.isArray(body.subtitles)) ? body.subtitles as Record<string, unknown> : {};
    const subtitleLines = Array.isArray(subtitles.lines) ? subtitles.lines.filter((line) => line && typeof line === "object" && typeof (line as { text?: unknown }).text === "string").slice(0, 40) : [];
    const sceneImages = Array.isArray(body.sceneImages) ? body.sceneImages.filter((item): item is { type: "source" | "actor"; id: string } => typeof item === "object" && item !== null && (item.type === "source" || item.type === "actor") && typeof item.id === "string").slice(0, 20) : [];
    const scenePrompts = Array.isArray(body.scenePrompts) ? body.scenePrompts.filter((item): item is string => typeof item === "string").slice(0, 12).map((item) => item.trim().slice(0, 500)) : [];
    const actorIds = Array.isArray(body.actorIds) ? [...new Set(body.actorIds.filter((item): item is string => typeof item === "string"))].slice(0, 8) : null;
    const now = Date.now();
    await env.DB.prepare(`UPDATE ad_projects SET title = ?, hook = ?, prompt = ?, scene_prompts = ?, scene_images = ?, engine = ?, aspect = ?, target_duration = ?, subtitles = ?, voiceover_script = ?, voice_id = ?, music_mood = ?, elevenlabs_on = ?, draft = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(
      title, str(body.hook, 280), str(body.prompt, 2000), JSON.stringify(scenePrompts), JSON.stringify(sceneImages),
      engine, aspect, targetDuration,
      JSON.stringify({ on: subtitles.on === true, position: subtitles.position === "top" ? "top" : "bottom", size: subtitles.size === "small" || subtitles.size === "large" ? subtitles.size : "medium", lines: subtitleLines }),
      str(body.voiceoverScript, 5000), typeof body.voiceId === "string" && body.voiceId ? body.voiceId.slice(0, 120) : null,
      adMusicMood(body.musicMood)?.id || null, body.elevenlabsOn === true ? 1 : 0, body.draft === true ? 1 : 0, now, id, admin.id,
    ).run();
    if (actorIds !== null) {
      await env.DB.prepare(`DELETE FROM ad_project_actors WHERE ad_project_id = ?`).bind(id).run();
      for (const actorId of actorIds) {
        const exists = await env.DB.prepare(`SELECT id FROM ad_actors WHERE id = ? AND owner_id = ? LIMIT 1`).bind(actorId, admin.id).first();
        if (exists) await env.DB.prepare(`INSERT OR IGNORE INTO ad_project_actors (ad_project_id, actor_id, created_at) VALUES (?, ?, ?)`).bind(id, actorId, now).run();
      }
    }
    const updated = await loadAd(env, id, admin.id);
    return Response.json({ ad: updated });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const ad = await loadAd(env, id, admin.id);
    if (!ad) return Response.json({ error: "Ad not found." }, { status: 404 });
    if (["queued", "generating", "stitching", "saving"].includes(ad.status)) return Response.json({ error: "This ad is still being made. Wait for it to finish before deleting it." }, { status: 409 });
    const assets = await env.DB.prepare(`SELECT r2_key AS r2Key FROM ad_assets WHERE ad_project_id = ? AND owner_id = ?`).bind(id, admin.id).all<{ r2Key: string }>();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ad_assets WHERE ad_project_id = ? AND owner_id = ?`).bind(id, admin.id),
      env.DB.prepare(`DELETE FROM ad_project_actors WHERE ad_project_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM ad_projects WHERE id = ? AND owner_id = ?`).bind(id, admin.id),
    ]);
    await Promise.allSettled((assets.results || []).map((asset) => env.BUCKET.delete(asset.r2Key)));
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
