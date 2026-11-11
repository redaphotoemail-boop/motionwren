import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../../_lib/account";
import { PHOTO_MOVE_KEYS, engineCost, studioEngine } from "../../../../../engine-catalog";
import { MUSIC_TEMPLATES, musicTemplate } from "../../../../../music-catalog";
import { motionLabel } from "../../../../../motion-label";
import { ElevenLabsMissingKey, makeSfx, makeVoice } from "../../../../_lib/film-sound";
import { cleanCards, loadManifest, outputKey, saveManifest } from "../../../../_lib/production";
import { getRenderJob, jobCardsNote, jobScenes, publicJob, runJobAction } from "../../../../_lib/render-jobs";
import { studioToken } from "../../../../_lib/studio-token";

/* Edit a finished film: change its listing cards, music, voiceover and sound
   effects, or make single scenes again with a new camera movement. The scenes
   that are kept are not made again (nothing is charged for them); only a scene
   made again costs, and the page shows that price first.
   GET  — what the film has now.
   POST — { cards?, music?, voice?, sfx?, scenes? } then the film is edited again and a new version lands in History. */

const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

async function ownJob(id: string) {
  const { env } = await import("cloudflare:workers");
  const ownerId = (await requireAdmin(env)).id;
  const row = validId(id) ? await getRenderJob(env, id, ownerId) : null;
  return { env, row };
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
      status: row.status, kind: row.kind, engine: manifest.engine, resolution: row.resolution, aspect: row.aspect, duration: row.duration,
      count: manifest.inputs.length, sceneSeconds: share, photoEngine: Boolean(manifest.photoMoves?.some(Boolean)),
      remakeCostCents: Math.round(engineCost(manifest.engine as never, row.resolution as never, manifest.sceneSeconds) * 100), engineName: engine?.name || manifest.engine,
      cards: manifest.cards ? { opening: manifest.cards.opening || null, closing: manifest.cards.closing ? { ...manifest.cards.closing, logo: manifest.cards.closing.logo ? "yes" : "" } : null } : null,
      music: musicId, voice: edit.sound?.voice ? { mode: edit.sound.voice.mode, voiceId: edit.sound.voice.voiceId, lines: edit.sound.voice.lines } : null,
      sfx: edit.sound?.sfx ? { prompts: edit.sound.sfx.prompts } : null,
      scenes: manifest.inputs.map((input, index) => ({ index, motion: manifest.photoMoves?.[index] || motionLabel(String(input.prompt || "")) || "", photo: `/api/job-frames/${id}/scene-${String(index + 1).padStart(2, "0")}.jpg` })),
    });
  } catch (error) { return jsonError(error); }
}

type Body = {
  cards?: unknown;
  music?: unknown;
  voice?: { mode?: unknown; voiceId?: unknown; lines?: unknown; film?: unknown } | null;
  sfx?: { on?: unknown; prompts?: unknown } | null;
  scenes?: { scene?: unknown; prompt?: unknown; photoMove?: unknown }[];
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownJob(id);
    if (!row) return NextResponse.json({ error: "Film not found." }, { status: 404 });
    if (row.status !== "succeeded") return NextResponse.json({ error: "Wait for this film to finish before editing it." }, { status: 409 });
    const token = await studioToken();
    if (!token) return NextResponse.json({ error: "The video engine is not connected yet." }, { status: 503 });
    const manifest = await loadManifest(env, id);
    if (!manifest) return NextResponse.json({ error: "This film was made before it could be edited." }, { status: 409 });
    const body = await request.json().catch(() => ({})) as Body;
    const count = manifest.inputs.length;
    const edit = manifest.edit || (manifest.edit = {});
    const sound = edit.sound || (edit.sound = {});

    // The kept scenes must still be stored.
    const redo = new Set((Array.isArray(body.scenes) ? body.scenes : []).map((item) => Number(item.scene)).filter((scene) => Number.isInteger(scene) && scene >= 0 && scene < count));
    for (let index = 0; index < count; index += 1) {
      if (redo.has(index) || manifest.photoMoves?.[index]) continue;
      if (!await env.BUCKET.head(outputKey(id, index))) return NextResponse.json({ error: "This film's scenes are no longer stored, so it can't be edited. Make it again from its photos." }, { status: 409 });
    }

    // Sound first: if a voice or effect can't be made, nothing else changes.
    try {
      if (body.voice !== undefined) {
        const mode = body.voice?.mode;
        if (mode === "off" || body.voice === null) delete sound.voice;
        else if (mode === "scene" || mode === "film") {
          const voiceId = text(body.voice?.voiceId, 64);
          if (!voiceId) return NextResponse.json({ error: "Choose a voice." }, { status: 400 });
          const lines = Array.isArray(body.voice?.lines) ? (body.voice!.lines as unknown[]).map((line) => text(line, 400)) : [];
          sound.voice = await makeVoice(env, id, { mode, voiceId, lines: Array.from({ length: count }, (_, index) => lines[index] || ""), film: text(body.voice?.film, 4000) }, count);
        }
      }
      if (body.sfx !== undefined) {
        if (!body.sfx || body.sfx.on !== true) delete sound.sfx;
        else {
          const prompts = Array.isArray(body.sfx.prompts) ? (body.sfx.prompts as unknown[]).map((prompt) => text(prompt, 140)) : [];
          const made = await makeSfx(env, id, Array.from({ length: count }, (_, index) => prompts[index] || ""), Math.min(edit.shareSeconds || manifest.sceneSeconds, 12));
          if (made) sound.sfx = made; else { delete sound.sfx; return NextResponse.json({ error: "None of the scenes has a sound to add. Describe one, or turn sound effects off." }, { status: 400 }); }
        }
      }
    } catch (error) {
      if (error instanceof ElevenLabsMissingKey) return NextResponse.json({ error: "The ElevenLabs key is not added yet.", fix: "elevenlabs" }, { status: 503 });
      const message = error instanceof Error ? error.message : "The sound could not be made.";
      return NextResponse.json({ error: message, fix: /402|paid_plan|payment_required|quota/i.test(message) ? "elevenlabs" : undefined }, { status: 502 });
    }

    if (body.cards !== undefined) {
      // "keep" in the logo field means: the closing card keeps the logo it already has.
      const incoming = body.cards as { closing?: { logo?: unknown } | null } | null;
      if (incoming?.closing && incoming.closing.logo === "keep") incoming.closing.logo = manifest.cards?.closing?.logo || "";
      const cards = body.cards === null ? undefined : cleanCards(body.cards); if (cards) manifest.cards = cards; else delete manifest.cards;
    }
    if (typeof body.music === "string" && body.music !== "keep") {
      if (body.music === "none") sound.noMusic = true;
      else {
        const template = musicTemplate(body.music);
        if (!template) return NextResponse.json({ error: "Unknown music." }, { status: 400 });
        delete sound.noMusic;
        edit.music = { prompt: template.prompt }; // a new prompt: the old saved track is not reused
      }
    }
    // A camera movement changed for a scene: that scene is made again.
    for (const item of Array.isArray(body.scenes) ? body.scenes : []) {
      const scene = Number(item.scene);
      if (!redo.has(scene)) continue;
      if (manifest.photoMoves?.[scene] && (PHOTO_MOVE_KEYS as readonly string[]).includes(String(item.photoMove))) manifest.photoMoves[scene] = String(item.photoMove);
      else if (typeof item.prompt === "string" && item.prompt.trim().length >= 20 && typeof manifest.inputs[scene].prompt === "string") manifest.inputs[scene] = { ...manifest.inputs[scene], prompt: item.prompt.trim().slice(0, 6000) };
    }
    await saveManifest(env, id, manifest);

    const webhook = row.webhookToken ? `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${row.webhookToken}` : undefined;
    let current = row; let failure = "";
    const scenesToMake = [...redo].filter((scene) => !manifest.photoMoves?.[scene] ? true : false);
    if (scenesToMake.length) {
      for (const scene of scenesToMake) {
        const result = await runJobAction(env, current, "regenerate-scene", scene, token, webhook);
        if ("error" in result) { failure = result.error; break; }
        current = (await getRenderJob(env, id)) || current;
      }
    }
    if (!scenesToMake.length || failure) {
      const result = await runJobAction(env, current, "reassemble", null, token, webhook);
      if ("error" in result) return NextResponse.json({ error: failure || result.error }, { status: 409 });
    }
    const fresh = await getRenderJob(env, id);
    return NextResponse.json({ job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh), cardsNote: await jobCardsNote(env, fresh) } : null, ...(failure ? { warning: failure } : {}) });
  } catch (error) { return jsonError(error); }
}
