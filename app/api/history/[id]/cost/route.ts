import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { loadManifest } from "../../../_lib/production";
import { filmCostLines } from "../../../../cost-model";
import { studioEngine } from "../../../../engine-catalog";

/* Owner only: every cost of one saved film, line by line. The engine line is what production recorded; the rest
   are estimates from list prices (the providers' own billing pages stay the final word). */
export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const id = new URL(request.url).pathname.split("/").at(-2) || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid history item." }, { status: 400 });
    const history = await env.DB.prepare(`SELECT engine, resolution, duration, cost_cents AS costCents FROM generation_history WHERE id = ?`).bind(id).first<{ engine: string; resolution: string; duration: number; costCents: number }>();
    if (!history) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    const job = await env.DB.prepare(`SELECT id, kind, status, cost_cents AS costCents FROM render_jobs WHERE history_id = ? ORDER BY created_at DESC LIMIT 1`).bind(id).first<{ id: string; kind: string; status: string; costCents: number }>();
    const engine = studioEngine(history.engine as never);
    if (!job) {
      const { lines, totalCents } = filmCostLines({ engineName: engine.name, engineCents: history.costCents, scenes: 1, sceneSeconds: history.duration, resolution: history.resolution, upscaled: false, duration: history.duration, edited: false, music: "none", voiceChars: 0, sfxCount: 0, sfxSeconds: 0, reviewCents: 0 });
      return NextResponse.json({ lines, totalCents });
    }
    const manifest = await loadManifest(env, job.id);
    const edit = manifest?.edit;
    const edited = Boolean(edit) && /series/.test(job.kind);
    const voice = edit?.sound?.voice;
    const voiceChars = voice ? (voice.mode === "film" ? voice.lines.join(" ").length : voice.lines.reduce((sum, line) => sum + line.length, 0)) : 0;
    const sfxCount = edit?.sound?.sfx?.tracks.filter(Boolean).length || 0;
    const review = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(`review-cost:${job.id}`).first<{ value?: string }>();
    const music = !edited || edit?.sound?.noMusic || !edit?.music ? "none" : edit.music.source === "library" ? "library" : "generated";
    // Automatic quality re-makes are billed again: show them on their own line. Rounds recorded before the price fix have no amount;
    // they were recorded at the engine's top-resolution price.
    const sceneSecs = manifest?.sceneSeconds || history.duration;
    const oldRate = engine.pricePerSecond[engine.resolutions.includes("1080p") ? "1080p" : engine.resolutions[engine.resolutions.length - 1]] || 0;
    const remakeCents = (manifest?.fix?.history || []).reduce((sum, round) => sum + (round.cents ?? Math.round(oldRate * sceneSecs * round.scenes.length * 100)), 0);
    const remakeRounds = manifest?.fix?.history.length || 0;
    const { lines, totalCents } = filmCostLines({
      remakeCents: Math.min(remakeCents, job.costCents), remakeRounds,
      engineName: studioEngine((manifest?.fix?.firstEngine || history.engine) as never).name, engineCents: Math.max(0, job.costCents - Math.min(remakeCents, job.costCents)), scenes: manifest?.inputs.length || 1, sceneSeconds: manifest?.sceneSeconds || history.duration, resolution: history.resolution,
      upscaled: Boolean(manifest?.upscale), duration: history.duration, edited, music, voiceChars, sfxCount, sfxSeconds: sfxCount * Math.min(manifest?.sceneSeconds || 5, 12), reviewCents: Number(review?.value) || 0,
    });
    return NextResponse.json({ lines, totalCents });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
