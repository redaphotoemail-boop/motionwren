import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../../_lib/account";
import { engineCost, studioEngine } from "../../../../../engine-catalog";
import { MUSIC_TEMPLATES } from "../../../../../music-catalog";
import { motionLabel } from "../../../../../motion-label";
import { loadManifest } from "../../../../_lib/production";
import { applyFilmEdit, cancelQueuedEdit, enqueueEdit, getRenderJob, jobCardsNote, jobScenes, publicJob, queueSummary, type FilmEditBody } from "../../../../_lib/render-jobs";
import { studioToken } from "../../../../_lib/studio-token";

/* Edit a finished film: change its listing cards, music, voiceover and sound
   effects, or make single scenes again with a new camera movement. The scenes
   that are kept are not made again (nothing is charged for them); only a scene
   made again costs, and the page shows that price first.
   An edit sent while the film is still being made is not refused: it waits in
   line and runs on its own when the film finishes (see the submission queue in
   render-jobs.ts). Send { cancelQueued: <id> } to take an edit out of the line.
   GET  — what the film has now, plus the line of edits waiting on it.
   POST — { cards?, music?, voice?, sfx?, scenes? } then the film is edited again and a new version lands in History. */

const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

async function ownJob(id: string) {
  const { env } = await import("cloudflare:workers");
  const ownerId = (await requireAdmin(env)).id;
  const row = validId(id) ? await getRenderJob(env, id, ownerId) : null;
  return { env, row };
}

async function jobView(env: { DB: D1Database; BUCKET: R2Bucket }, row: Awaited<ReturnType<typeof getRenderJob>>) {
  return row ? { ...publicJob(row), scenes: await jobScenes(env, row), cardsNote: await jobCardsNote(env, row) } : null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownJob(id);
    if (!row) return NextResponse.json({ error: "Film not found." }, { status: 404 });
    const manifest = await loadManifest(env, id);
    if (!manifest) return NextResponse.json({ error: "This film was made before it could be edited." }, { status: 409 });
    const edit = manifest.edit || {};
    const musicId = edit.sound?.noMusic ? "none" : MUSIC_TEMPLATES.find((template) => template.prompt === edit.music?.prompt)?.id || "auto";
    const engine = studioEngine(manifest.engine as never);
    const share = edit.shareSeconds || manifest.sceneSeconds;
    return NextResponse.json({
      status: row.status, kind: row.kind, engine: manifest.engine, resolution: row.resolution, aspect: row.aspect, frameRatio: manifest.frame?.ratio || null, cut: edit.reframe || null, duration: row.duration,
      count: manifest.inputs.length, sceneSeconds: share, photoEngine: Boolean(manifest.photoMoves?.some(Boolean)),
      remakeCostCents: Math.round(engineCost(manifest.engine as never, row.resolution as never, manifest.sceneSeconds) * 100), engineName: engine?.name || manifest.engine,
      cards: manifest.cards ? { opening: manifest.cards.opening || null, closing: manifest.cards.closing ? { ...manifest.cards.closing, logo: manifest.cards.closing.logo ? "yes" : "" } : null } : null,
      music: musicId, voice: edit.sound?.voice ? { mode: edit.sound.voice.mode, voiceId: edit.sound.voice.voiceId, lines: edit.sound.voice.lines } : null,
      sfx: edit.sound?.sfx ? { prompts: edit.sound.sfx.prompts } : null,
      scenes: manifest.inputs.map((input, index) => ({ index, motion: manifest.photoMoves?.[index] || motionLabel(String(input.prompt || "")) || "", photo: `/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg`, clip: manifest.saved[index] ? `/api/job-frames/${id}/out-${String(index + 1).padStart(2, "0")}.mp4` : "" })),
      titles: edit.titles || null,
      template: edit.recipe ? { on: true, used: edit.useScenes || null } : null,
      queue: queueSummary(manifest, row),
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownJob(id);
    if (!row) return NextResponse.json({ error: "Film not found." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as FilmEditBody & { cancelQueued?: unknown };
    // Take an edit out of the line.
    if (typeof body.cancelQueued === "string" && body.cancelQueued) {
      const cancelled = await cancelQueuedEdit(env, id, body.cancelQueued);
      if ("error" in cancelled) return NextResponse.json({ error: cancelled.error }, { status: 404 });
      return NextResponse.json({ job: await jobView(env, row), queue: cancelled.queue });
    }
    delete (body as { cancelQueued?: unknown }).cancelQueued;
    // The film is still being made: the edit waits in line and runs on its own when the film finishes.
    if (row.status !== "succeeded") {
      const queued = await enqueueEdit(env, row, body);
      if ("error" in queued) return NextResponse.json({ error: queued.error }, { status: 409 });
      return NextResponse.json({ job: await jobView(env, row), queued: { id: queued.entry.id, position: queued.position, label: queued.entry.label }, queue: queued.queue }, { status: 202 });
    }
    const token = await studioToken();
    const webhook = row.webhookToken ? `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${row.webhookToken}` : undefined;
    const result = await applyFilmEdit(env, row, body, token, webhook);
    if ("error" in result) return NextResponse.json({ error: result.error, fix: result.fix }, { status: result.status });
    return NextResponse.json({ job: result.job, ...(result.warning ? { warning: result.warning } : {}) });
  } catch (error) { return jsonError(error); }
}
