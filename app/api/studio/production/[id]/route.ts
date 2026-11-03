import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { getRenderJob, jobScenes, publicJob, resumeRenderJob } from "../../../_lib/render-jobs";
import { MAX_FRAME_BYTES, framesPresent, loadManifest, startProductionScenes, storeFrameBytes } from "../../../_lib/production";
import { studioToken } from "../../../_lib/studio-token";

/* Steps 2 and 3 of a Studio video (see ../route.ts), and picking a stopped
   one back up:
   PUT  ?scene=N  — one scene's prepared photo (raw JPEG body).
   POST           — start: every photo is in, so the scenes are started.
   POST {"action":"resume"} — pick a stopped video back up. */

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
    await storeFrameBytes(env, id, scene - 1, await request.arrayBuffer(), contentType);
    // Sending photos counts as progress, so the server waits for the rest.
    await env.DB.prepare(`UPDATE render_jobs SET updated_at = ? WHERE id = ? AND status = 'starting'`).bind(Date.now(), id).run();
    return NextResponse.json({ ok: true, scene });
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

    if (body.action === "resume") {
      const result = await resumeRenderJob(env, row, token, webhook);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      const fresh = await getRenderJob(env, id);
      return NextResponse.json({ redo: result.redo, job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh) } : null });
    }

    if (row.status !== "starting") {
      // Already started (a second click, or the server carried on by itself).
      return NextResponse.json({ job: { ...publicJob(row), scenes: await jobScenes(env, row) } });
    }
    const manifest = await loadManifest(env, id);
    if (!manifest) return NextResponse.json({ error: "This video's settings were not saved. Please start again." }, { status: 409 });
    const present = await framesPresent(env, id, manifest.inputs.length);
    const missing = present.map((value, index) => value ? 0 : index + 1).filter(Boolean);
    if (missing.length) return NextResponse.json({ error: `Scene ${missing.join(", ")} has no photo yet.`, missing }, { status: 409 });
    // Only one start: the check that carries a cut-off start forward uses the same claim.
    const claim = await env.DB.prepare(`UPDATE render_jobs SET updated_at = ? WHERE id = ? AND status = 'starting' AND updated_at = ?`).bind(Date.now(), id, row.updatedAt).run();
    if (claim.meta.changes) {
      try {
        await startProductionScenes(env, token, id, manifest, webhook, JSON.parse(row.predictionIds || "[]") as string[]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The video could not start.";
        await env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'starting'`).bind(message.slice(0, 1000), Date.now(), id).run();
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }
    const fresh = await getRenderJob(env, id);
    return NextResponse.json({ job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh) } : null });
  } catch (error) { return jsonError(error); }
}
