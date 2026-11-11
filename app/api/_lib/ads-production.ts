/* Studio Ads production: starts an ad the way startOrder starts a customer
   order, but with the ads prompt theme, no move presets, and the ads-only
   extras (hook, per-scene prompts, actors, subtitles, ElevenLabs voiceover,
   ad music moods, draft renders). It reuses the same scene queue and the
   same composer edit — the job row is kind 'ad-series', and the manifest
   carries ads=true so the pipeline treats it as an ad (composer edit even
   for a single clip, no reality check). It never imports the real-estate
   prompt module. */

import { ADS_THEME, adAspectRatio, adPlan, buildAdScenePrompt, estimateAdCost, splitScriptToSubtitles, type AdActorRef, type AdAspect, type SubtitleLine, type SubtitleStyle } from "../../ads-creative";
import { buildMasterPromptPrompt, parseMasterPromptFields, resolveAdTemplate, resolveTemplateDuration, type AdTemplateId } from "../../ads-master-prompt";
import { LIBRARY_TEMPLATE_THEME, libraryTemplateEstimate, libraryTemplateOverlayLines, libraryTemplatePlan, parseLibraryTemplateFields, type LibraryTemplateId } from "../../library-templates";
import { adMusicMood, defaultAdMusicMood } from "../../ads-music-catalog";
import { CROSSFADE_SECONDS, engineUpscales } from "../../engine-catalog";
import { ENGINE_ENDPOINTS, buildEngineInput, engineResolution, isEngineKey } from "../../engine-providers";
import { HttpError } from "./account";
import { ElevenLabsMissingKey, listVoices, synthesizeVoiceover } from "./elevenlabs";
import { newManifest, saveManifest, voiceoverKey } from "./production";
import { advanceRenderJob, beginQueue, getRenderJob } from "./render-jobs";

type Env = { DB: D1Database; BUCKET: R2Bucket };

export type AdProjectRow = {
  id: string; title: string; hook: string | null; prompt: string;
  scenePrompts: string; sceneImages: string; template: string; templateFields: string; engine: string; resolution: string;
  aspect: string; targetDuration: number; subtitles: string; voiceoverScript: string;
  voiceId: string | null; musicMood: string | null; elevenlabsOn: number; draft: number; status: string;
  renderJobId: string | null; finalHistoryId: string | null; costCents: number;
};

export type AdSceneImage = { type: "source" | "actor"; id: string };

const ACTIVE_STATUSES = ["queued", "generating", "stitching", "saving", "completed"];
const AD_GENERATING_STATUSES = ["queued", "generating", "stitching", "saving"];

/* NOTE: this SELECT names the 0013 columns (template, template_fields) —
   it errors with "no such column" until migration 0013 has run in the D1
   console (merge, then run the migration, then use — same order as 0012). */
export async function loadAd(env: Env, adId: string, ownerId: string) {
  return env.DB.prepare(`SELECT id, title, hook, prompt, scene_prompts AS scenePrompts, scene_images AS sceneImages, template, template_fields AS templateFields, engine, resolution, aspect, target_duration AS targetDuration, subtitles, voiceover_script AS voiceoverScript, voice_id AS voiceId, music_mood AS musicMood, elevenlabs_on AS elevenlabsOn, draft, status, render_job_id AS renderJobId, final_history_id AS finalHistoryId, cost_cents AS costCents FROM ad_projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(adId, ownerId).first<AdProjectRow>();
}

export function parseSceneImages(value: string): AdSceneImage[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AdSceneImage => typeof item === "object" && item !== null && (item.type === "source" || item.type === "actor") && typeof item.id === "string");
  } catch { return []; }
}

export function parseScenePrompts(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => typeof item === "string" ? item : "") : [];
  } catch { return []; }
}

export type AdSubtitleSettings = { on: boolean; position: SubtitleStyle["position"]; size: SubtitleStyle["size"]; lines: SubtitleLine[] };

export function parseSubtitles(value: string): AdSubtitleSettings {
  const fallback: AdSubtitleSettings = { on: false, position: "bottom", size: "medium", lines: [] };
  try {
    const parsed = JSON.parse(value || "{}") as Partial<AdSubtitleSettings>;
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const lines = Array.isArray(parsed.lines) ? parsed.lines.filter((line) => line && typeof line.text === "string" && typeof line.start === "number" && typeof line.end === "number") : [];
    return {
      on: parsed.on === true,
      position: parsed.position === "top" ? "top" : "bottom",
      size: parsed.size === "small" || parsed.size === "large" ? parsed.size : "medium",
      lines,
    };
  } catch { return fallback; }
}

type SceneImageResolved = { type: "source" | "actor"; id: string; r2Key: string; table: "ad_assets" | "ad_actor_photos" };

async function resolveSceneImages(env: Env, ad: AdProjectRow, ownerId: string): Promise<SceneImageResolved[]> {
  let wanted = parseSceneImages(ad.sceneImages);
  if (!wanted.length) {
    const rows = await env.DB.prepare(`SELECT id FROM ad_assets WHERE ad_project_id = ? AND owner_id = ? AND kind = 'source' ORDER BY sort_order, created_at`).bind(ad.id, ownerId).all<{ id: string }>();
    wanted = (rows.results || []).map((row) => ({ type: "source" as const, id: row.id }));
  }
  const resolved: SceneImageResolved[] = [];
  for (const item of wanted) {
    if (item.type === "source") {
      const row = await env.DB.prepare(`SELECT id, r2_key AS r2Key FROM ad_assets WHERE id = ? AND ad_project_id = ? AND owner_id = ? LIMIT 1`).bind(item.id, ad.id, ownerId).first<{ id: string; r2Key: string }>();
      if (row) resolved.push({ type: "source", id: row.id, r2Key: row.r2Key, table: "ad_assets" });
    } else {
      const row = await env.DB.prepare(`SELECT id, r2_key AS r2Key FROM ad_actor_photos WHERE id = ? AND owner_id = ? LIMIT 1`).bind(item.id, ownerId).first<{ id: string; r2Key: string }>();
      if (row) resolved.push({ type: "actor", id: row.id, r2Key: row.r2Key, table: "ad_actor_photos" });
    }
  }
  return resolved;
}

async function loadAdActorRefs(env: Env, adId: string, ownerId: string): Promise<AdActorRef[]> {
  const actors = await env.DB.prepare(`SELECT a.id, a.name FROM ad_actors a JOIN ad_project_actors l ON l.actor_id = a.id WHERE l.ad_project_id = ? AND a.owner_id = ? ORDER BY a.name`).bind(adId, ownerId).all<{ id: string; name: string }>();
  const refs: AdActorRef[] = [];
  for (const actor of actors.results || []) {
    const photos = await env.DB.prepare(`SELECT angle FROM ad_actor_photos WHERE actor_id = ? AND owner_id = ? ORDER BY sort_order, created_at`).bind(actor.id, ownerId).all<{ angle: string }>();
    refs.push({ name: actor.name, angles: [...new Set((photos.results || []).map((photo) => photo.angle))] });
  }
  return refs;
}

export async function markAdStartFailed(env: Env, jobId: string, adId: string, ownerId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Production could not start.";
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).bind(message.slice(0, 1000), now, jobId),
    env.DB.prepare(`UPDATE ad_projects SET status = 'failed', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, adId, ownerId),
  ]);
}

export async function startAd(env: Env, ad: AdProjectRow, ownerId: string, origin: string, providerToken: string) {
  if (ad.renderJobId && ACTIVE_STATUSES.includes(ad.status)) return { jobId: ad.renderJobId, status: ad.status, resumed: true };
  if (!["draft", "failed"].includes(ad.status)) throw new HttpError(409, "This ad cannot be started from its current state.");
  const engine = isEngineKey(ad.engine) ? ad.engine : "wan3";
  const resolution = ad.draft ? "480p" as const : engineResolution(engine);
  const aspect = (ad.aspect === "vertical" || ad.aspect === "horizontal" || ad.aspect === "square" ? ad.aspect : "vertical") as AdAspect;
  /* The template decides the length and the theme: a "Fix It In 20 Seconds"
     ad is locked to 30 s (10 s cannot hold its structure, 60 s would
     stretch past the 30 s the prompt forbids) and its filled master prompt
     — structure, rules, legal DO / DON'T — sits where ADS_THEME sits for
     a cinematic ad: first in every scene prompt and as the job's stored
     prompt. A cinematic ad is exactly today's behavior. A library
     template ad is locked to its recorded structure instead — 17 s
     vertical for Restaurant Interior, its warm golden theme, hard cuts
     (crossfade 0), its Luxe & warm music mood, and its text overlays
     burned in over the user's own subtitles. */
  const template: AdTemplateId = resolveAdTemplate(ad.template);
  const targetDuration = resolveTemplateDuration(template, ad.targetDuration);
  const library = parseLibraryTemplateFields(ad.templateFields || "");
  const libraryTemplate: LibraryTemplateId = library.libraryTemplate;
  const theme = libraryTemplate !== "none" ? LIBRARY_TEMPLATE_THEME : template === "fix-it-20" ? buildMasterPromptPrompt(parseMasterPromptFields(ad.templateFields)) : ADS_THEME;
  const images = await resolveSceneImages(env, ad, ownerId);
  if (!images.length) throw new HttpError(409, "Upload at least one image for this ad.");
  const actors = await loadAdActorRefs(env, ad.id, ownerId);
  const plan = libraryTemplate !== "none"
    ? libraryTemplatePlan(engine, resolution, images.length, Boolean(ad.draft))
    : adPlan(engine, resolution, targetDuration, images.length, Boolean(ad.draft));
  const scenes = images.slice(0, plan.count);
  const sceneSeconds = plan.sceneSeconds;
  const subtitles = parseSubtitles(ad.subtitles);
  const script = ad.voiceoverScript.trim();
  if (subtitles.on && !subtitles.lines.length && !script) throw new HttpError(409, "Subtitles are on but there is nothing to show: add subtitle lines or a voiceover script.");
  const userSubtitleLines = subtitles.on ? (subtitles.lines.length ? subtitles.lines : splitScriptToSubtitles(script, plan.totalSeconds)) : [];
  const subtitleLines = libraryTemplate !== "none"
    ? [...libraryTemplateOverlayLines(libraryTemplate, library.fields, plan.totalSeconds, plan.shareSeconds), ...userSubtitleLines]
    : userSubtitleLines;
  // ElevenLabs sound is optional and off by default: the video engine
  // usually already made sound. Off means no ElevenLabs call at all —
  // no music key in the manifest, no voiceover synthesis — while the
  // stored script still feeds subtitles. On keeps today's behavior.
  const elevenlabsOn = ad.elevenlabsOn === 1;
  // A library template's music mood is Luxe & warm — the route coerces it
  // when the ad is saved, and "luxe" is the fallback if it is missing.
  const musicMoodId = libraryTemplate !== "none" ? (ad.musicMood || "luxe") : ad.musicMood;
  const music = elevenlabsOn ? (adMusicMood(musicMoodId) || adMusicMood(defaultAdMusicMood(aspect, plan.totalSeconds))) : null;
  const costCents = Math.round((libraryTemplate !== "none"
    ? libraryTemplateEstimate(engine, images.length, Boolean(ad.draft))
    : estimateAdCost(engine, resolution, targetDuration, images.length, Boolean(ad.draft))) * 100);

  const jobId = crypto.randomUUID();
  const webhookToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const webhook = `${origin}/api/webhooks/replicate/${jobId}?token=${webhookToken}`;
  const now = Date.now();
  let voiceoverSaved = false;
  try {
    // Voiceover first: if ElevenLabs cannot make it, fail before any
    // generation money is spent. Skipped entirely when the toggle is
    // off, even with a script stored — ElevenLabs is never called.
    if (elevenlabsOn && script) {
      let voiceId = ad.voiceId || "";
      if (!voiceId) {
        const voices = await listVoices();
        if (!voices.length) throw new Error("ElevenLabs has no voices on this account.");
        voiceId = voices[0].voiceId;
      }
      const audio = await synthesizeVoiceover({ voiceId, text: script });
      await env.BUCKET.put(voiceoverKey(jobId), audio, { httpMetadata: { contentType: "audio/mpeg" } });
      voiceoverSaved = true;
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO render_jobs (id, owner_id, kind, status, prediction_ids, segment_urls, stitch_prediction_id, prompt, category, resolution, aspect, duration, cost_cents, error, history_id, webhook_token, created_at, updated_at) VALUES (?, ?, 'ad-series', 'starting', '[]', '[]', NULL, ?, 'ad', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(jobId, ownerId, theme, resolution, aspect, plan.totalSeconds, costCents, webhookToken, now, now),
      env.DB.prepare(`UPDATE ad_projects SET status = 'queued', render_job_id = ?, cost_cents = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(jobId, costCents, now, ad.id, ownerId),
    ]);

    const scenePrompts = parseScenePrompts(ad.scenePrompts);
    const inputs: Record<string, unknown>[] = [];
    const photos: { key: string; link: string }[] = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const image = scenes[index];
      const assetToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await env.DB.prepare(`UPDATE ${image.table === "ad_assets" ? "ad_assets" : "ad_actor_photos"} SET provider_token = ? WHERE id = ? AND owner_id = ?`).bind(assetToken, image.id, ownerId).run();
      const imageUrl = `${origin}/api/provider-assets/${image.id}?token=${assetToken}`;
      photos.push({ key: image.r2Key, link: imageUrl });
      const prompt = buildAdScenePrompt({ userPrompt: ad.prompt, scenePrompt: scenePrompts[index] || "", hook: ad.hook || "", sceneIndex: index, actors, theme });
      inputs.push(buildEngineInput(engine, { imageUrl, prompt, duration: sceneSeconds, resolution, aspectRatio: adAspectRatio(engine, aspect) }));
    }
    const manifest = newManifest(engine, ENGINE_ENDPOINTS[engine], sceneSeconds, inputs, undefined, photos);
    manifest.ads = true;
    if (engineUpscales(engine, resolution)) manifest.upscale = { to: "1080p" };
    manifest.edit = {
      shareSeconds: plan.shareSeconds,
      crossfade: libraryTemplate !== "none" ? 0 : CROSSFADE_SECONDS,
      ...(elevenlabsOn && music ? { music: { prompt: music.prompt } } : {}),
      ...(subtitleLines.length ? { subtitles: { lines: subtitleLines, position: subtitles.position, size: subtitles.size } } : {}),
      ...(voiceoverSaved ? { voiceover: { saved: "voiceover.mp3" } } : {}),
    };
    await saveManifest(env, jobId, manifest);
    if (await beginQueue(env, jobId)) { const queued = await getRenderJob(env, jobId); if (queued) await advanceRenderJob(env, queued, providerToken, webhook); }
    await env.DB.prepare(`UPDATE ad_projects SET status = 'generating', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(Date.now(), ad.id, ownerId).run();
  } catch (error) {
    if (error instanceof ElevenLabsMissingKey) throw new HttpError(503, "The ElevenLabs key is not added yet. Add it as a Worker secret to make voiceovers.");
    if (jobId) await markAdStartFailed(env, jobId, ad.id, ownerId, error);
    throw error;
  }
  return { jobId, status: "generating" };
}

/* The ad's live state for the list: its job row (same shape as the manager's
   production view) plus the finished film link when it has one. */
export async function adJobState(env: Env, ad: AdProjectRow, ownerId: string) {
  if (!ad.renderJobId) return null;
  const row = await env.DB.prepare(`SELECT id, status, error, history_id AS historyId, duration, cost_cents AS costCents, created_at AS createdAt, updated_at AS updatedAt FROM render_jobs WHERE id = ? AND owner_id = ? LIMIT 1`).bind(ad.renderJobId, ownerId).first<{ id: string; status: string; error: string | null; historyId: string | null; duration: number; costCents: number; createdAt: number; updatedAt: number }>();
  return row || null;
}

export { AD_GENERATING_STATUSES };
