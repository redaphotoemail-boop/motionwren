import { loadManifest } from "./production";
import { filmCostLines } from "../../cost-model";
import { studioEngine } from "../../engine-catalog";

/* Every cost of one film, line by line (the engine line is what production recorded; the rest are estimates from list
   prices). Used by the Cost tab in History and by the one-film breakdown in Finance, so both always agree. */
type CostEnv = { DB: D1Database } & Record<string, unknown>;
export type JobForCost = { id: string; kind: string; status: string; costCents: number };
export type HistoryForCost = { engine: string; resolution: string; duration: number; costCents: number };

export async function jobCostLines(env: CostEnv, job: JobForCost, history: HistoryForCost) {
  const manifest = await loadManifest(env as never, job.id);
  const edit = manifest?.edit;
  const edited = Boolean(edit) && /series/.test(job.kind);
  const voice = edit?.sound?.voice;
  const voiceChars = voice ? (voice.mode === "film" ? voice.lines.join(" ").length : voice.lines.reduce((sum, line) => sum + line.length, 0)) : 0;
  const sfxCount = edit?.sound?.sfx?.tracks.filter(Boolean).length || 0;
  const review = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(`review-cost:${job.id}`).first<{ value?: string }>();
  // The AI photo reader's cost is kept inside the film's one "AI" total (so every total agrees); show it on its own line.
  const movementCents = Math.max(0, Number(manifest?.movementPlan?.costCents) || 0);
  const music = !edited || edit?.sound?.noMusic || !edit?.music ? "none" : edit.music.source === "library" ? "library" : "generated";
  // Automatic quality re-makes are billed again: show them on their own line. Rounds recorded before the price fix have no amount;
  // they were recorded at the engine's top-resolution price.
  const engine = studioEngine(history.engine as never);
  const sceneSecs = manifest?.sceneSeconds || history.duration;
  const oldRate = engine.pricePerSecond[engine.resolutions.includes("1080p") ? "1080p" : engine.resolutions[engine.resolutions.length - 1]] || 0;
  const remakeCents = (manifest?.fix?.history || []).reduce((sum, round) => sum + (round.cents ?? Math.round(oldRate * sceneSecs * round.scenes.length * 100)), 0);
  const remakeRounds = manifest?.fix?.history.length || 0;
  return filmCostLines({
    remakeCents: Math.min(remakeCents, job.costCents), remakeRounds,
    engineName: studioEngine((manifest?.fix?.firstEngine || history.engine) as never).name, engineCents: Math.max(0, job.costCents - Math.min(remakeCents, job.costCents)), scenes: manifest?.inputs.length || 1, sceneSeconds: manifest?.sceneSeconds || history.duration, resolution: history.resolution,
    upscaled: Boolean(manifest?.upscale), duration: history.duration, edited, music, voiceChars, sfxCount, sfxSeconds: sfxCount * Math.min(manifest?.sceneSeconds || 5, 12), reviewCents: Math.max(0, (Number(review?.value) || 0) - movementCents), movementCents,
  });
}
