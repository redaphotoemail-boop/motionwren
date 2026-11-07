/* Studio Ads: list + create. Admin only. */
import { enforceRateLimit, jsonError, requireAdmin } from "../../_lib/account";
import { adMusicMood } from "../../../ads-music-catalog";
import { AD_DURATIONS, estimateAdCost } from "../../../ads-creative";
import { isEngineKey } from "../../../engine-providers";

function cleanStr(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanStringArray(value: unknown, maxEach: number, maxCount: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, maxCount).map((item) => item.trim().slice(0, maxEach));
}

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const rows = await env.DB.prepare(`SELECT id, title, hook, prompt, scene_prompts AS scenePrompts, scene_images AS sceneImages, engine, resolution, aspect, target_duration AS targetDuration, subtitles, voiceover_script AS voiceoverScript, voice_id AS voiceId, music_mood AS musicMood, draft, status, render_job_id AS renderJobId, final_history_id AS finalHistoryId, cost_cents AS costCents, created_at AS createdAt, updated_at AS updatedAt FROM ad_projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(admin.id).all();
    return Response.json({ ads: rows.results || [] });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "studio-ads-create", 30, 60 * 60 * 1000);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = cleanStr(body.title, 120);
    if (title.length < 2) return Response.json({ error: "Give the ad a title (at least 2 characters)." }, { status: 400 });
    const engine = isEngineKey(body.engine) ? body.engine : "wan3";
    const aspect = body.aspect === "horizontal" || body.aspect === "square" ? body.aspect : "vertical";
    const targetDuration = (AD_DURATIONS as readonly number[]).includes(Number(body.targetDuration)) ? Number(body.targetDuration) : 10;
    const subtitles = (body.subtitles && typeof body.subtitles === "object" && !Array.isArray(body.subtitles)) ? body.subtitles as Record<string, unknown> : {};
    const subtitleLines = Array.isArray(subtitles.lines) ? subtitles.lines.filter((line) => line && typeof line === "object" && typeof (line as { text?: unknown }).text === "string").slice(0, 40) : [];
    const sceneImages = Array.isArray(body.sceneImages) ? body.sceneImages.filter((item): item is { type: "source" | "actor"; id: string } => typeof item === "object" && item !== null && (item.type === "source" || item.type === "actor") && typeof item.id === "string").slice(0, 20) : [];
    const id = crypto.randomUUID();
    const now = Date.now();
    const ad = {
      id, title,
      hook: cleanStr(body.hook, 280),
      prompt: cleanStr(body.prompt, 2000),
      scenePrompts: JSON.stringify(cleanStringArray(body.scenePrompts, 500, 12)),
      sceneImages: JSON.stringify(sceneImages),
      engine, resolution: "1080p", aspect, targetDuration,
      subtitles: JSON.stringify({
        on: subtitles.on === true,
        position: subtitles.position === "top" ? "top" : "bottom",
        size: subtitles.size === "small" || subtitles.size === "large" ? subtitles.size : "medium",
        lines: subtitleLines,
      }),
      voiceoverScript: cleanStr(body.voiceoverScript, 5000),
      voiceId: typeof body.voiceId === "string" && body.voiceId ? body.voiceId.slice(0, 120) : null,
      musicMood: adMusicMood(body.musicMood)?.id || null,
      draft: body.draft === true ? 1 : 0,
    };
    await env.DB.prepare(`INSERT INTO ad_projects (id, owner_id, title, hook, prompt, scene_prompts, scene_images, engine, resolution, aspect, target_duration, subtitles, voiceover_script, voice_id, music_mood, draft, status, render_job_id, final_history_id, cost_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, 0, ?, ?)`).bind(ad.id, admin.id, ad.title, ad.hook, ad.prompt, ad.scenePrompts, ad.sceneImages, ad.engine, ad.resolution, ad.aspect, ad.targetDuration, ad.subtitles, ad.voiceoverScript, ad.voiceId, ad.musicMood, ad.draft, now, now).run();
    const photoCount = Math.max(1, sceneImages.length);
    return Response.json({ ad: { ...ad, status: "draft", renderJobId: null, finalHistoryId: null, costCents: 0, createdAt: now, updatedAt: now }, estimateCents: Math.round(estimateAdCost(engine, "1080p", targetDuration as 10 | 30 | 60, photoCount, ad.draft === 1) * 100) }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
