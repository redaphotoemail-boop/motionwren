import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { cleanFilmTitles } from "../../../../titles";
import { CROSSFADE_SECONDS, UPSCALE_PER_SECOND, engineUpscales, nativeResolution, studioEngine, type StudioResolution } from "../../../../engine-catalog";
import { ENGINE_ENDPOINTS } from "../../../../engine-providers";
import { advanceRenderJob, getRenderJob, publicJob } from "../../../_lib/render-jobs";
import { frameKey, loadManifest, newManifest, outputKey, saveManifest } from "../../../_lib/production";
import { studioToken } from "../../../_lib/studio-token";
import { musicPrompt } from "../../../_lib/composer";
import { makeCutEffects } from "../../../_lib/film-sound";
import { musicTemplate } from "../../../../music-catalog";
import { getRecipe, recipeFor } from "../../../_lib/wrencut";
import { socialSpec } from "../../../../social-templates";
import { isWrenId, joinTimes, recipeSeconds } from "../../../../wrencut";

/* Owner only (Studio): a NEW film made from clips that were already generated for earlier films. Nothing is sent to a video
   engine and nothing is charged for scenes — the clips are copied, then joined by the editor (plain joins, or a WrenCut
   template) with the chosen music and titles. The new film gets its own reference number and shows in History. */
const MAX_CLIPS = 12;

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const ownerId = (await requireAdmin(env)).id;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
    const picks = Array.isArray(body.clips) ? (body.clips as { jobId?: unknown; scene?: unknown }[]) : [];
    if (picks.length < 2 || picks.length > MAX_CLIPS) return NextResponse.json({ error: `Choose between 2 and ${MAX_CLIPS} clips.` }, { status: 400 });

    // Every clip must be the owner's own, still stored, and share one frame shape.
    type Source = { jobId: string; scene: number; aspect: string; resolution: string; engine: string; sceneSeconds: number; prompt: Record<string, unknown> };
    const sources: Source[] = [];
    const manifests = new Map<string, Awaited<ReturnType<typeof loadManifest>>>();
    for (const pick of picks) {
      const jobId = typeof pick.jobId === "string" ? pick.jobId : "";
      const scene = Number(pick.scene);
      if (!/^[0-9a-f-]{36}$/i.test(jobId) || !Number.isInteger(scene) || scene < 0) return NextResponse.json({ error: "A chosen clip is not valid." }, { status: 400 });
      const row = await getRenderJob(env, jobId, ownerId);
      if (!row || !row.kind.startsWith("studio-")) return NextResponse.json({ error: "A chosen clip was not found." }, { status: 404 });
      if (!manifests.has(jobId)) manifests.set(jobId, await loadManifest(env, jobId));
      const manifest = manifests.get(jobId);
      if (!manifest || scene >= manifest.inputs.length || !(await env.BUCKET.head(outputKey(jobId, scene)))) return NextResponse.json({ error: "A chosen clip is no longer stored. Choose another." }, { status: 409 });
      sources.push({ jobId, scene, aspect: row.aspect, resolution: row.resolution, engine: manifest.engine, sceneSeconds: manifest.sceneSeconds, prompt: manifest.inputs[scene] });
    }
    if (new Set(sources.map((item) => item.aspect)).size > 1) return NextResponse.json({ error: "These clips have different frame shapes (16:9, vertical…). Choose clips of one shape." }, { status: 400 });
    const first = sources[0];
    const engine = first.engine as Parameters<typeof studioEngine>[0];
    const resolution = first.resolution as StudioResolution;
    const aspect = first.aspect;
    const count = sources.length;
    const sceneSeconds = Math.min(...sources.map((item) => item.sceneSeconds));

    const wrenAsked = typeof body.template === "object" && body.template !== null ? (body.template as { wren?: unknown }).wren : undefined;
    const wren = isWrenId(wrenAsked) ? await getRecipe(env, wrenAsked) : null;
    if (wrenAsked !== undefined && !wren) return NextResponse.json({ error: "That template is no longer available. Choose another." }, { status: 400 });
    const recipe = wren ? recipeFor(wren, count) : null;
    const duration = recipe ? recipeSeconds(recipe) : Math.round((count * sceneSeconds - (count - 1) * CROSSFADE_SECONDS) * 1000) / 1000;
    // A version made to be looked at first: kept at the engine's own 720p (no upscale yet). The upscale is the last touch, once it is approved ("Upscale to 1080p" in History).
    const keepNative = body.upscale === false && engineUpscales(engine, resolution);
    const upscales = !keepNative && engineUpscales(engine, resolution);
    const rowResolution = keepNative ? nativeResolution(engine, resolution) : resolution;
    const costCents = upscales ? Math.round(UPSCALE_PER_SECOND * duration * 100) : 0; // only the 1080p upscale of the new film, if any

    const id = crypto.randomUUID();
    const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const origin = new URL(request.url).origin;
    const now = Date.now();
    const link = (index: number) => `${origin}/api/job-frames/${id}/out-${String(index + 1).padStart(2, "0")}.mp4?token=${webhookToken}`;
    const photoLink = (index: number) => `${origin}/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg?token=${webhookToken}`;

    // Copy each chosen clip (and its photo) into the new film's own folder.
    for (let index = 0; index < count; index += 1) {
      const source = sources[index];
      const clip = await env.BUCKET.get(outputKey(source.jobId, source.scene));
      if (!clip) return NextResponse.json({ error: "A chosen clip is no longer stored. Choose another." }, { status: 409 });
      await env.BUCKET.put(outputKey(id, index), await clip.arrayBuffer(), { httpMetadata: { contentType: "video/mp4" } });
      const photo = await env.BUCKET.get(frameKey(source.jobId, source.scene));
      if (photo) await env.BUCKET.put(frameKey(id, index), await photo.arrayBuffer(), { httpMetadata: { contentType: photo.httpMetadata?.contentType || "image/jpeg" } });
    }

    const inputs = sources.map((source, index) => Object.fromEntries(Object.entries(source.prompt).map(([key, value]) => [key, typeof value === "string" && value.includes("/api/job-frames/") ? photoLink(index) : value])));
    const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, undefined, sources.map((_, index) => ({ key: frameKey(id, index), link: photoLink(index) })));
    manifest.fromClips = sources.map((item) => ({ jobId: item.jobId, scene: item.scene }));
    for (let index = 0; index < count; index += 1) { manifest.states[index] = "ready"; manifest.attempts[index] = 1; manifest.outputs[index] = link(index); manifest.saved[index] = outputKey(id, index); manifest.readyAt[index] = now; }
    if (upscales) manifest.upscale = { to: "1080p" };
    const picked = musicTemplate(body.music);
    manifest.edit = { shareSeconds: sceneSeconds, crossfade: wren ? 0 : CROSSFADE_SECONDS, music: { prompt: picked ? picked.prompt : recipe?.audio?.music?.prompt || musicPrompt({ aspect, duration }) } };
    if (recipe) { manifest.edit.recipe = recipe; manifest.edit.templateName = wren?.name; }
    // A social template has its own canvas: a 16:9 film becomes vertical (or the reverse) with a cut, never a stretch (nothing is made again).
    const canvas = wren?.social ? socialSpec(wren.social)?.frame : undefined;
    if ((canvas === "vertical" || canvas === "horizontal") && (aspect === "vertical" || aspect === "horizontal") && canvas !== aspect) manifest.edit.reframe = canvas;
    if (body.music === "none") manifest.edit.sound = { noMusic: true };
    const titles = cleanFilmTitles(body.titles);
    if (titles) manifest.edit.titles = titles;
    if (recipe?.audio?.sfx?.length) {
      try { const cutfx = await makeCutEffects(env, id, recipe.audio, joinTimes(recipe)); if (cutfx) manifest.edit.sound = { ...(manifest.edit.sound || {}), cutfx }; } catch { /* made without them */ }
    }
    await saveManifest(env, id, manifest);
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : `${Math.round(duration)}-second film from saved clips`;
    await env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'studio-series', 'generating', ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
      .bind(id, ownerId, JSON.stringify(sources.map((_, index) => `clip-${index + 1}`)), JSON.stringify(sources.map((_, index) => link(index))), String(sources[0].prompt.prompt || "Film from saved clips").slice(0, 6000), `Studio · ${label}`, rowResolution, aspect, duration, costCents, webhookToken, now, now).run();
    const token = (await studioToken()) || "";
    const row = await getRenderJob(env, id);
    if (row) await advanceRenderJob(env, row, token, `${origin}/api/webhooks/replicate/${id}?token=${webhookToken}`);
    const fresh = await getRenderJob(env, id);
    return NextResponse.json({ job: fresh ? { ...publicJob(fresh), scenes: sources.map(() => ({ state: "ready", attempt: 1 })) } : { id, status: "generating" }, plan: { count, sceneSeconds, duration, costCents } });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
