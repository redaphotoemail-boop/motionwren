import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { cleanFilmTitles } from "../../../../titles";
import { UPSCALE_PER_SECOND, engineUpscales, nativeResolution, type StudioResolution } from "../../../../engine-catalog";
import { ENGINE_ENDPOINTS } from "../../../../engine-providers";
import { advanceRenderJob, getRenderJob, publicJob } from "../../../_lib/render-jobs";
import { frameKey, newManifest, saveManifest, storeFrame } from "../../../_lib/production";
import { studioToken } from "../../../_lib/studio-token";
import { musicPrompt } from "../../../_lib/composer";
import { musicTemplate } from "../../../../music-catalog";
import { recipeWithNightSlots, templateRecipeById } from "../../../../template-recipes";

/* Owner only (Studio): a NEW film made from the photos supplied, edited by
   a template recipe (spec v1) — no AI generation of the shots. The photos
   are the template's inputs, in the recipe's inputs order; the composer
   loops stills into clips, applies the recipe's camera moves, speed ramps,
   grades and captions, and joins the scenes. A night slot (named in
   `nightSlots`) renders its day photo with the night grade instead of its
   own grade — a grade only, so the house does not change. Nothing is
   charged for scenes (there is no generation); only a 1080p upscale, if
   asked for, costs. The new film gets its own reference number and shows
   in History. */

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const ownerId = (await requireAdmin(env)).id;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

    const templateId = typeof body.templateRecipe === "string" ? body.templateRecipe : (typeof body.template === "object" && body.template !== null ? (body.template as { templateRecipe?: unknown }).templateRecipe : undefined);
    const entry = typeof templateId === "string" ? templateRecipeById(templateId) : null;
    if (!entry) return NextResponse.json({ error: "That template is no longer available. Choose another." }, { status: 400 });
    const recipe = entry.recipe;
    const nightSlots = Array.isArray(body.nightSlots) ? (body.nightSlots as unknown[]).filter((s): s is string => typeof s === "string") : (typeof body.template === "object" && body.template !== null && Array.isArray((body.template as { nightSlots?: unknown }).nightSlots) ? ((body.template as { nightSlots: unknown[] }).nightSlots.filter((s): s is string => typeof s === "string")) : []);
    const withNight = recipeWithNightSlots(recipe, nightSlots);

    const photos = Array.isArray(body.photos) ? (body.photos as unknown[]) : [];
    if (photos.length !== recipe.inputs.length) return NextResponse.json({ error: `This template needs ${recipe.inputs.length} photos, one per slot (${recipe.inputs.map((i) => i.slot).join(", ")}).` }, { status: 400 });
    for (const photo of photos) {
      if (typeof photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) return NextResponse.json({ error: "Every photo must be an uploaded image." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const origin = new URL(request.url).origin;
    const now = Date.now();
    const aspect = "vertical";
    const resolution = "1080p" as StudioResolution;
    const duration = recipe.duration_s;
    const count = recipe.inputs.length;
    const sceneSeconds = Math.round((duration / count) * 1000) / 1000;

    // Store each photo as the job's frame, in the recipe's inputs order.
    for (let index = 0; index < count; index += 1) await storeFrame(env, id, index, photos[index] as string);
    const photoLink = (index: number) => `${origin}/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg?token=${webhookToken}`;

    const engine = "wan3";
    const inputs = recipe.inputs.map((input, index) => ({ prompt: `Template film: ${input.slot}`, imageUrl: photoLink(index) }));
    const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, undefined, recipe.inputs.map((_, index) => ({ key: frameKey(id, index), link: photoLink(index) })));
    // The scenes are ready: the photos are the inputs, already stored.
    // outputs/saved are left empty on purpose — the segments are our own
    // photo URLs (durable, in our storage, no expiry), so the queue must
    // not try to copy them as finished scene videos; and leaving saved
    // empty keeps the join using the photo links as the clips, which is
    // what the composer's template branch expects (it loops stills).
    for (let index = 0; index < count; index += 1) { manifest.states[index] = "ready"; manifest.attempts[index] = 1; }
    const keepNative = body.upscale === false && engineUpscales(engine, resolution);
    const upscales = !keepNative && engineUpscales(engine, resolution);
    const rowResolution = keepNative ? nativeResolution(engine, resolution) : resolution;
    const costCents = upscales ? Math.round(UPSCALE_PER_SECOND * duration * 100) : 0; // only the 1080p upscale of the new film, if any
    if (upscales) manifest.upscale = { to: "1080p" };
    const picked = musicTemplate(body.music);
    manifest.edit = { shareSeconds: sceneSeconds, crossfade: 0, music: { prompt: picked ? picked.prompt : musicPrompt({ aspect, duration }) }, templateRecipe: withNight, templateName: entry.name };
    if (body.music === "none") manifest.edit.sound = { noMusic: true };
    const titles = cleanFilmTitles(body.titles);
    if (titles) manifest.edit.titles = titles;
    await saveManifest(env, id, manifest);
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : `${entry.name} · ${Math.round(duration)}-second film from your photos`;
    // The segments are the photos themselves: the composer loops stills
    // into clips, so a photo URL is a valid "clip" for the template.
    await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'studio-series', 'generating', ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
      .bind(id, ownerId, JSON.stringify(recipe.inputs.map((_, index) => `photo-${index + 1}`)), JSON.stringify(recipe.inputs.map((_, index) => photoLink(index))), `Template film: ${entry.name}`, `Studio · ${label}`, rowResolution, aspect, duration, costCents, webhookToken, now, now).run();
    const token = (await studioToken()) || "";
    const row = await getRenderJob(env, id);
    if (row) await advanceRenderJob(env, row, token, `${origin}/api/webhooks/replicate/${id}?token=${webhookToken}`);
    const fresh = await getRenderJob(env, id);
    return NextResponse.json({ job: fresh ? { ...publicJob(fresh), scenes: recipe.inputs.map(() => ({ state: "ready", attempt: 1 })) } : { id, status: "generating" }, plan: { count, sceneSeconds, duration, costCents } });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
