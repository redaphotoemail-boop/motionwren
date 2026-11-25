import { NextResponse } from "next/server";
import { audit, jsonError, requireAccount } from "../../../_lib/account";
import { MUSIC_TEMPLATES } from "../../../../music-catalog";
import { ElevenLabsMissingKey, listVoices } from "../../../_lib/elevenlabs";
import { loadManifest, saveManifest } from "../../../_lib/production";
import { applyFilmEdit, getRenderJob, sceneOrder, type FilmEditBody } from "../../../_lib/render-jobs";
import { studioToken } from "../../../_lib/studio-token";

/* The client's own editor for a delivered film (Reda, Nov 25 2026). All optional, after delivery:
   - change the words on the opening and closing cards (an overlay; nothing is made again),
   - put the scenes in another order, cut the film to another frame (16:9, 9:16, 1:1, 4:5),
   - change the music or the voiceover,
   - make one scene again, see it in the film, and put an earlier version back at any time (takes are kept).
   Each edit becomes a new version of the film; earlier versions stay in History.
   Scene remakes are the only thing that costs us money: CUSTOMER_REMAKES_DEFAULT are included with each film
   (setting `customer_remakes`), and more are refused until pricing for them is decided.
   GET  — what the film has now, and what can be changed.
   POST — { cards?, music?, voice?, frame?, order?, remake?: { scene }, useTake?: { scene, take } }. */

export const CUSTOMER_REMAKES_DEFAULT = 2;
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const FRAMES = new Set(["horizontal", "vertical", "square", "portrait", "made"]);

async function ownFilm(id: string) {
  const { env } = await import("cloudflare:workers");
  const account = await requireAccount(env);
  if (!validId(id)) return { env, account, project: null, row: null };
  const project = await env.DB.prepare(`SELECT id, status, render_job_id AS jobId FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, account.id).first<{ id: string; status: string; jobId: string | null }>();
  const row = project?.jobId ? await getRenderJob(env, project.jobId, account.id) : null;
  return { env, account, project, row };
}

async function remakesIncluded(env: { DB: D1Database }) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'customer_remakes'`).first<{ value?: string }>().catch(() => null);
  const value = Number(row?.value);
  return Number.isInteger(value) && value >= 0 && value <= 20 ? value : CUSTOMER_REMAKES_DEFAULT;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownFilm(id);
    if (!row || row.kind !== "customer-series") return NextResponse.json({ error: "Film not found." }, { status: 404 });
    const manifest = await loadManifest(env, row.id);
    if (!manifest) return NextResponse.json({ error: "This film was made before it could be edited." }, { status: 409 });
    const count = manifest.inputs.length;
    const edit = manifest.edit || {};
    const order = sceneOrder(edit.order, count) || Array.from({ length: count }, (_, index) => index);
    const file = (name: string) => `/api/projects/${id}/film/${name}`;
    const pad = (index: number) => String(index + 1).padStart(2, "0");
    const musicId = edit.sound?.noMusic ? "none" : MUSIC_TEMPLATES.find((template) => template.prompt === edit.music?.prompt)?.id || "auto";
    let voices: { id: string; name: string; note: string; previewUrl: string }[] = [];
    try {
      voices = (await listVoices()).filter((voice) => voice.previewUrl).slice(0, 12).map((voice) => ({ id: voice.voiceId, name: voice.name, note: [voice.labels.gender, voice.labels.accent, voice.labels.age].filter(Boolean).join(" · "), previewUrl: voice.previewUrl }));
    } catch (error) { if (!(error instanceof ElevenLabsMissingKey)) voices = []; }
    const included = await remakesIncluded(env);
    return NextResponse.json({
      status: row.status === "succeeded" ? "ready" : "updating",
      frame: edit.reframe || "made", madeRatio: manifest.frame?.ratio || null,
      order,
      scenes: Array.from({ length: count }, (_, index) => ({
        index, photo: file(`scene-${pad(index)}.jpg`), clip: file(`out-${pad(index)}.mp4`),
        takes: (manifest.takes?.[index] || []).map((take, takeIndex) => ({ take: takeIndex, clip: file(take.file), at: take.at })),
        still: manifest.lineGuardResult?.find((item) => item.scene === index + 1)?.used === "still",
      })),
      cards: manifest.cards ? { opening: manifest.cards.opening || null, closing: manifest.cards.closing ? { ...manifest.cards.closing, logo: manifest.cards.closing.logo ? "keep" : "" } : null } : null,
      music: musicId, musicChoices: MUSIC_TEMPLATES.map((template) => ({ id: template.id, name: template.name })),
      voice: edit.sound?.voice ? { mode: edit.sound.voice.mode, voiceId: edit.sound.voice.voiceId, film: edit.sound.voice.mode === "film" ? edit.sound.voice.lines?.[0] || "" : "" } : null,
      voices,
      sceneSounds: Boolean(edit.sound?.sfx || edit.sound?.voice?.mode === "scene"),
      remakes: { used: manifest.customerRemakes || 0, included },
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, account, row } = await ownFilm(id);
    if (!row || row.kind !== "customer-series") return NextResponse.json({ error: "Film not found." }, { status: 404 });
    if (row.status !== "succeeded") return NextResponse.json({ error: "Your film is being updated. You can make another change once it's ready." }, { status: 409 });
    const raw = await request.json().catch(() => ({})) as Record<string, unknown>;
    // Only what a client may change; everything else in the owner's editor stays the owner's.
    const body: FilmEditBody = {};
    if (raw.cards !== undefined) body.cards = raw.cards;
    if (typeof raw.music === "string") body.music = raw.music;
    if (raw.voice !== undefined) {
      const voice = raw.voice as { mode?: unknown; voiceId?: unknown; film?: unknown } | null;
      if (voice === null || voice?.mode === "off") body.voice = null;
      else if (voice?.mode === "film") body.voice = { mode: "film", voiceId: voice.voiceId, film: voice.film };
      else return NextResponse.json({ error: "Choose one voiceover for the whole film, or none." }, { status: 400 });
    }
    if (raw.frame !== undefined) { if (!FRAMES.has(String(raw.frame))) return NextResponse.json({ error: "Unknown frame." }, { status: 400 }); body.frame = raw.frame; }
    if (raw.order !== undefined) body.order = raw.order;
    if (raw.useTake) body.useTake = raw.useTake as FilmEditBody["useTake"];
    let remade = false;
    if (raw.remake && typeof raw.remake === "object") {
      const manifest = await loadManifest(env, row.id);
      const scene = Number((raw.remake as { scene?: unknown }).scene);
      if (!manifest || !Number.isInteger(scene) || scene < 0 || scene >= manifest.inputs.length) return NextResponse.json({ error: "Unknown scene." }, { status: 400 });
      const included = await remakesIncluded(env);
      if ((manifest.customerRemakes || 0) >= included) return NextResponse.json({ error: `You've used the ${included} scene remakes included with this film.`, limit: true }, { status: 402 });
      body.scenes = [{ scene }];
      remade = true;
    }
    if (!Object.keys(body).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    const token = await studioToken();
    const webhook = row.webhookToken ? `${new URL(request.url).origin}/api/webhooks/replicate/${row.id}?token=${row.webhookToken}` : undefined;
    const result = await applyFilmEdit(env, row, body, token, webhook);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    if (remade) {
      const manifest = await loadManifest(env, row.id);
      if (manifest) { manifest.customerRemakes = (manifest.customerRemakes || 0) + 1; await saveManifest(env, row.id, manifest); }
    }
    await audit(env, account.id, "film.customer_edit", "project", id, { changed: Object.keys(body) }).catch(() => undefined);
    return NextResponse.json({ ok: true, status: "updating" });
  } catch (error) { return jsonError(error); }
}
