import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { advanceRenderJob, beginQueue, fixSceneByHand, getRenderJob, jobCardsNote, jobScenes, publicJob, runJobAction, startOverJob } from "../../../_lib/render-jobs";
import { MAX_FRAME_BYTES, frameKey, framesPresent, loadManifest, storeFrameBytes } from "../../../_lib/production";
import type { JobAction } from "../../../_lib/scene-queue";
import { studioToken } from "../../../_lib/studio-token";

/* Steps 2 and 3 of a Studio video (see ../route.ts), and picking a stopped
   one back up:
   PUT  ?scene=N  — one scene's prepared photo (raw JPEG body). With an x-photo-sha256 header the photo is checked
                    against it, then read back from storage, and the reply says how many bytes are really stored.
   GET  ?photos=1 — which photos the server really holds (their sizes), so a page can send only what is missing.
   POST           — start: every photo is in, so the video joins the queue. With { photos: [{ bytes, sha256 }] } each
                    stored photo's size is checked against what the page sent, and the reply says how many were verified.
   POST {"action": "resume" | "retry-scene" | "regenerate-scene" | "reassemble", "scene"?: n}
                  — act on a video through the same queue (never duplicates engine jobs).
   POST {"action": "start-over"} — a new run with the same photos and settings. */

const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

async function ownJob(id: string) {
  const { env } = await import("cloudflare:workers");
  const ownerId = (await requireAdmin(env)).id;
  const row = validId(id) ? await getRenderJob(env, id, ownerId) : null;
  return { env, row };
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownJob(id);
    if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    if (row.status !== "starting") return NextResponse.json({ error: "This video has already started." }, { status: 409 });
    const manifest = await loadManifest(env, id);
    const scene = Number(new URL(request.url).searchParams.get("scene"));
    if (!manifest || !Number.isInteger(scene) || scene < 1 || scene > manifest.inputs.length) return NextResponse.json({ error: "Unknown scene." }, { status: 400 });
    const contentType = (request.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) return NextResponse.json({ error: "Send the scene's photo as a JPEG, PNG or WebP." }, { status: 415 });
    const size = Number(request.headers.get("content-length")) || 0;
    if (size > MAX_FRAME_BYTES) return NextResponse.json({ error: "This photo is too large." }, { status: 413 });
    const bytes = await request.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const claimed = (request.headers.get("x-photo-sha256") || "").toLowerCase();
    if (claimed && claimed !== digest) return NextResponse.json({ error: "The photo arrived damaged. Sending it again." }, { status: 422 });
    await storeFrameBytes(env, id, scene - 1, bytes, contentType);
    // Read it back: only a photo that is really stored at its full size counts as received.
    const stored = await env.BUCKET.head(frameKey(id, scene - 1));
    if (!stored || stored.size !== bytes.byteLength) return NextResponse.json({ error: "The photo could not be stored. Sending it again." }, { status: 502 });
    // Sending photos counts as progress, so the server waits for the rest.
    await env.DB.prepare(`UPDATE render_jobs SET updated_at = ? WHERE id = ? AND status = 'starting'`).bind(Date.now(), id).run();
    return NextResponse.json({ ok: true, scene, bytes: stored.size, sha256: digest });
  } catch (error) { return jsonError(error); }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownJob(id);
    if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    if (new URL(request.url).searchParams.get("photos") !== "1") return NextResponse.json({ error: "Nothing to show." }, { status: 400 });
    const manifest = await loadManifest(env, id);
    const total = manifest?.inputs.length || 0;
    const sizes = await Promise.all(Array.from({ length: total }, async (_, index) => (await env.BUCKET.head(frameKey(id, index)))?.size || 0));
    return NextResponse.json({ status: row.status, total, sizes, received: sizes.filter(Boolean).length });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env, row } = await ownJob(id);
    if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    const token = await studioToken();
    if (!token) return NextResponse.json({ error: "The video engine is not connected yet." }, { status: 503 });
    const webhook = row.webhookToken ? `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${row.webhookToken}` : undefined;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    if (body.action === "start-over") {
      const result = await startOverJob(env, row, token, new URL(request.url).origin);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      const fresh = result.id ? await getRenderJob(env, result.id) : null;
      return NextResponse.json({ replaced: id, job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh), cardsNote: await jobCardsNote(env, fresh) } : null });
    }
    if (body.action === "fix-scene") {
      const result = await fixSceneByHand(env, row, Number.isInteger(body.scene) ? Number(body.scene) : -1, token, webhook);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      const fresh = await getRenderJob(env, id);
      return NextResponse.json({ instruction: result.text, cents: result.cents, job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh), cardsNote: await jobCardsNote(env, fresh) } : null });
    }
    if (["resume", "retry-scene", "regenerate-scene", "reassemble", "restart-scene"].includes(String(body.action))) {
      const scene = Number.isInteger(body.scene) ? Number(body.scene) : null;
      const result = await runJobAction(env, row, body.action as JobAction, scene, token, webhook);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      const fresh = await getRenderJob(env, id);
      return NextResponse.json({ redo: result.redo, job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh), cardsNote: await jobCardsNote(env, fresh) } : null });
    }

    if (row.status !== "starting") {
      // Already started (a second click, or the server carried on by itself).
      return NextResponse.json({ job: { ...publicJob(row), scenes: await jobScenes(env, row), cardsNote: await jobCardsNote(env, row) } });
    }
    const manifest = await loadManifest(env, id);
    if (!manifest) return NextResponse.json({ error: "This video's settings were not saved. Please start again." }, { status: 409 });
    const present = await framesPresent(env, id, manifest.inputs.length);
    const missing = present.map((value, index) => value ? 0 : index + 1).filter(Boolean);
    if (missing.length) return NextResponse.json({ error: `Scene ${missing.join(", ")} has no photo yet.`, missing }, { status: 409 });
    // The page says how big each photo was; every stored photo must match, or it is asked for again.
    const expected = Array.isArray(body.photos) ? (body.photos as { bytes?: unknown }[]).map((item) => Number(item?.bytes)) : [];
    let verified = 0;
    if (expected.length === manifest.inputs.length) {
      const sizes = await Promise.all(expected.map(async (_, index) => (await env.BUCKET.head(frameKey(id, index)))?.size || 0));
      const wrong = sizes.map((size, index) => size === expected[index] ? 0 : index + 1).filter(Boolean);
      if (wrong.length) return NextResponse.json({ error: `Photo ${wrong.join(", ")} did not arrive complete.`, missing: wrong }, { status: 409 });
      verified = sizes.length;
    }
    // Into the queue (only once, however many times this is clicked); the
    // first scene is sent right away if the engine has room.
    if (await beginQueue(env, id)) { const fresh = await getRenderJob(env, id); if (fresh) await advanceRenderJob(env, fresh, token, webhook); }
    const fresh = await getRenderJob(env, id);
    return NextResponse.json({ verified, job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh), cardsNote: await jobCardsNote(env, fresh) } : null });
  } catch (error) { return jsonError(error); }
}
