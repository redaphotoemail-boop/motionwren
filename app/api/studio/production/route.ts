import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { CROSSFADE_SECONDS, PHOTO_MOVE_KEYS, engineCost, engineUpscales, engineDurationOptions, filmSceneDurations, preferredDurationForEngine, sceneTimingSetting, scenePlan, studioEngine, VIDEO_LENGTHS, type StudioResolution } from "../../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, isEngineKey } from "../../../engine-providers";
import { advanceRenderJob, beginQueue, getRenderJob, publicJob } from "../../_lib/render-jobs";
import { PHOTO_MOVE_CYCLE, cleanCards, frameKey, newManifest, saveManifest, storeFrame } from "../../_lib/production";
import { studioToken } from "../../_lib/studio-token";
import { musicPrompt } from "../../_lib/composer";
import { ElevenLabsMissingKey, makeCutEffects, makeSfx, makeVoice } from "../../_lib/film-sound";
import { musicTemplate } from "../../../music-catalog";
import { getRecipe } from "../../_lib/wrencut";
import { isWrenId, joinTimes, recipeSeconds, titleLines, wrenPlan } from "../../../wrencut";
import { LIBRARY_TEMPLATE_MUSIC_MOOD, cleanLibraryTemplateFields, emptyRestaurantInteriorFields, libraryTemplateOverlayLines, libraryTemplatePlan } from "../../../library-templates";

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
  // A library template (optional): its own structure replaces the length choice; the scenes themselves are made exactly as always.
  const libraryPick = mode === "series" ? cleanLibraryTemplateFields(body.template) : { libraryTemplate: "none" as const, fields: emptyRestaurantInteriorFields() };
  const templated = libraryPick.libraryTemplate !== "none";
  // A WrenCut template (optional): its recipe decides the film's length, cuts, moves and colour.
  const wrenAsked = mode === "series" && typeof body.template === "object" && body.template !== null ? (body.template as { wren?: unknown }).wren : undefined;
  const wren = isWrenId(wrenAsked) ? await getRecipe(env, wrenAsked) : null;
  if (wrenAsked !== undefined && !wren) return NextResponse.json({ error: "That template is no longer available. Choose another." }, { status: 400 });
  const aspect = templated || wren?.recipe.aspect === "vertical" ? "vertical" : body.aspect === "vertical" ? "vertical" : body.aspect === "cinematic" ? "cinematic" : "horizontal";
  const scenesIn = Array.isArray(body.scenes) ? body.scenes as SceneBody[] : [];
  const inline = scenesIn.length > 0 && scenesIn.every((scene) => typeof scene.image === "string");
  const valid = scenesIn.filter((scene) => typeof scene.prompt === "string" && scene.prompt.trim().length >= 20 && (!inline || (String(scene.image).startsWith("data:image/") && String(scene.image).length <= MAX_INLINE_FRAME)));
  if (valid.length !== scenesIn.length || !valid.length || valid.length > 12) return NextResponse.json({ error: "Every scene needs a clear prompt (and at most 12 scenes)." }, { status: 400 });
  if (mode === "series" && valid.length < 2) return NextResponse.json({ error: "Add at least two scenes." }, { status: 400 });

  // How many scenes and how long each, so the film lands on the chosen length.
  let count = 1, sceneSeconds: number, duration: number, shareSeconds = 0;
  if (mode === "single") {
    sceneSeconds = preferredDurationForEngine(engine, Math.max(3, Math.min(15, Math.round(Number(body.clipSeconds) || 5))), resolution);
    duration = sceneSeconds;
  } else {
    const length = VIDEO_LENGTHS.includes(Number(body.length) as (typeof VIDEO_LENGTHS)[number]) ? Number(body.length) : 30;
    const timingRow = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'multi_shot_seconds_per_image'`).first<{ value?: string }>();
    const plan = wren ? wrenPlan(engine, resolution, valid.length, recipeSeconds(wren.recipe)) : templated ? libraryTemplatePlan(engine, resolution, valid.length) : scenePlan(engine, resolution, length, valid.length, sceneTimingSetting(timingRow?.value));
    count = plan.count; sceneSeconds = plan.sceneSeconds; duration = plan.totalSeconds; shareSeconds = plan.shareSeconds;
  }
  const lengths: number[] = mode === "single" ? engineDurationOptions(engine, resolution) : filmSceneDurations(engine, resolution);
  if (!lengths.includes(sceneSeconds)) return NextResponse.json({ error: "This engine cannot make scenes of that length." }, { status: 400 });
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
  const links = scenes.map((_, index) => `${origin}/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg?token=${webhookToken}`);
  const inputs = scenes.map((scene, index) => buildEngineInput(engine, {
    imageUrl: links[index],
    prompt: String(scene.prompt), duration: sceneSeconds, resolution, aspectRatio: aspect === "vertical" ? "9:16" : "16:9",
    audio: mode === "series" ? false : scene.audio === true, seed: seed === undefined ? undefined : seed + index,
  }));
  // One soundtrack across the joined film (when the scenes have sound), never a different track per scene.
  const audio = mode === "series" && body.audioMode === "single_master" ? { mode: "single_master" as const, direction: typeof body.audioDirection === "string" ? body.audioDirection.slice(0, 1200) : "", voiceoverScript: typeof body.voiceoverScript === "string" ? body.voiceoverScript.slice(0, 2000) : "" } : undefined;
  const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, audio, links.map((link, index) => ({ key: frameKey(id, index), link })));
  // The final edit: each scene's share on screen and the film's one music track.
  if (engine === "photo" || engine === "photo2" || engine === "photo3") {
    if (engine !== "photo") manifest.photoStrict = true;
    if (engine === "photo3") { manifest.photoMetric = true; manifest.photoHybrid = true; }
    const asked = (PHOTO_MOVE_KEYS as readonly string[]).includes(String(body.photoMove)) ? String(body.photoMove) : "push-rise";
    manifest.photoMoves = mode === "single" ? [asked] : scenes.map((_, index) => PHOTO_MOVE_CYCLE[index % PHOTO_MOVE_CYCLE.length]);
  }
  const cards = cleanCards(body.cards);
  if (cards) manifest.cards = cards;
  if (engineUpscales(engine, resolution)) manifest.upscale = { to: "1080p" };
  if (mode === "series") {
    const picked = musicTemplate(body.music);
    manifest.edit = { shareSeconds, crossfade: templated ? 0 : CROSSFADE_SECONDS, music: { prompt: picked ? picked.prompt : wren?.recipe.audio?.music?.prompt || musicPrompt({ aspect, duration, choice: templated || wren ? LIBRARY_TEMPLATE_MUSIC_MOOD : null }) } };
    if (templated) {
      // Hard cuts, the template's text over the film, and its warm look.
      const lines = libraryTemplateOverlayLines(libraryPick.libraryTemplate, libraryPick.fields, duration, shareSeconds);
      if (lines.length) manifest.edit.subtitles = { lines };
      manifest.edit.grade = "warm";
    }
    if (wren) {
      manifest.edit.crossfade = 0; manifest.edit.recipe = wren.recipe;
      // The template's titles, with the words typed for this film.
      const words = typeof body.template === "object" && body.template !== null && Array.isArray((body.template as { texts?: unknown }).texts) ? ((body.template as { texts: unknown[] }).texts).map((item) => String(item ?? "")) : [];
      const titles = titleLines(wren.recipe, words, recipeSeconds(wren.recipe));
      if (titles.length) manifest.edit.subtitles = { lines: titles };
    }
    if (body.music === "none") manifest.edit.sound = { noMusic: true };
  }
  const soundIn = body.sound && typeof body.sound === "object" ? body.sound as { voice?: { mode?: unknown; voiceId?: unknown; lines?: unknown; film?: unknown } | null; sfx?: { on?: unknown; prompts?: unknown } | null } : null;
  try {
    // The film's own voice and sound effects are made now, before any scene is paid for: if they can't be, the film doesn't start.
    const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
    if (soundIn?.voice && (soundIn.voice.mode === "scene" || soundIn.voice.mode === "film") && clean(soundIn.voice.voiceId, 64)) {
      const lines = Array.isArray(soundIn.voice.lines) ? (soundIn.voice.lines as unknown[]).map((line) => clean(line, 400)) : [];
      const voice = await makeVoice(env, id, { mode: mode === "single" ? "film" : soundIn.voice.mode, voiceId: clean(soundIn.voice.voiceId, 64), lines: Array.from({ length: scenes.length }, (_, index) => lines[index] || ""), film: clean(soundIn.voice.film, 4000) || lines.join(" ") }, scenes.length);
      manifest.edit = { ...(manifest.edit || {}), sound: { ...(manifest.edit?.sound || {}), voice } };
    }
    if (soundIn?.sfx && soundIn.sfx.on === true) {
      const prompts = Array.isArray(soundIn.sfx.prompts) ? (soundIn.sfx.prompts as unknown[]).map((prompt) => clean(prompt, 140)) : [];
      const sfx = await makeSfx(env, id, Array.from({ length: scenes.length }, (_, index) => prompts[index] || ""), Math.min(sceneSeconds, 12));
      if (sfx) manifest.edit = { ...(manifest.edit || {}), sound: { ...(manifest.edit?.sound || {}), sfx } };
    }
    if (wren?.recipe.audio?.sfx?.length && manifest.edit) {
      // The template's own effects on its cuts (whooshes, hits), made from its prompts. Best effort: a film never waits on them.
      try {
        const cutfx = await makeCutEffects(env, id, wren.recipe.audio, joinTimes(wren.recipe));
        if (cutfx) manifest.edit.sound = { ...(manifest.edit.sound || {}), cutfx };
      } catch { /* the film is made without them */ }
    }
    await saveManifest(env, id, manifest);
    if (inline) {
      // Older Studio page: photos came inline, so the video goes straight into the queue.
      for (let index = 0; index < scenes.length; index += 1) await storeFrame(env, id, index, String(scenes[index].image));
      if (await beginQueue(env, id)) { const row = await getRenderJob(env, id); if (row) await advanceRenderJob(env, row, token, `${origin}/api/webhooks/replicate/${id}?token=${webhookToken}`); }
    }
  } catch (error) {
    const missingKey = error instanceof ElevenLabsMissingKey;
    const message = missingKey ? "The ElevenLabs key is not added yet, so the voice and sound effects can't be made. Nothing was charged." : error instanceof Error ? error.message : "The video could not start.";
    await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), Date.now(), id).run();
    return NextResponse.json({ error: message, ...(missingKey || /402|paid_plan|payment_required/i.test(message) ? { fix: "elevenlabs" } : {}) }, { status: missingKey ? 503 : 502 });
  }
  const row = await getRenderJob(env, id);
  return NextResponse.json({ job: row ? { ...publicJob(row), scenes: scenes.map(() => ({ state: "waiting", attempt: 0 })) } : { id, status: "starting" }, plan: { count: scenes.length, sceneSeconds, duration, costCents } });
}
