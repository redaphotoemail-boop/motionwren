import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { suggestSound, writeOptions } from "../../_lib/film-sound";
import { frameKey, loadManifest } from "../../_lib/production";
import { getRenderJob } from "../../_lib/render-jobs";

/* Reads the scenes and writes the voiceover lines and the sound effects that
   fit them. Either the photos of a film not yet made (small data URLs) or the
   id of a finished film (its stored photos). Nothing is charged or stored. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const owner = await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { action?: unknown; target?: unknown; index?: unknown; current?: unknown; lines?: unknown; instruction?: unknown; images?: unknown; jobId?: unknown; sceneSeconds?: unknown; totalSeconds?: unknown };
    let images: Uint8Array[] = [];
    let sceneSeconds = Math.max(2, Math.min(15, Number(body.sceneSeconds) || 5));
    let totalSeconds = Math.max(5, Math.min(120, Number(body.totalSeconds) || 30));
    if (typeof body.jobId === "string" && /^[0-9a-f-]{36}$/i.test(body.jobId)) {
      const row = await getRenderJob(env, body.jobId, owner.id);
      const manifest = row ? await loadManifest(env, row.id) : null;
      if (!row || !manifest) return NextResponse.json({ error: "Film not found." }, { status: 404 });
      for (let index = 0; index < manifest.inputs.length; index += 1) {
        const object = await env.BUCKET.get(frameKey(row.id, index));
        if (!object) return NextResponse.json({ error: "This film's photos are no longer stored." }, { status: 409 });
        images.push(new Uint8Array(await object.arrayBuffer()));
      }
      sceneSeconds = manifest.edit?.shareSeconds || manifest.sceneSeconds; totalSeconds = row.duration;
    } else if (Array.isArray(body.images) && body.images.length >= 1 && body.images.length <= 12) {
      for (const item of body.images) {
        const match = typeof item === "string" ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(item) : null;
        if (!match || match[1].length > 900_000) return NextResponse.json({ error: "A photo could not be read." }, { status: 400 });
        images.push(Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)));
      }
    } else return NextResponse.json({ error: "Send the scenes' photos or a film." }, { status: 400 });
    if (body.action === "options") {
      const lines = Array.isArray(body.lines) ? body.lines.slice(0, 12).map((line) => String(line ?? "").slice(0, 500)) : [];
      const result = await writeOptions(env, images, {
        target: body.target === "film" ? "film" : "scene", index: Math.max(0, Math.min(images.length - 1, Number(body.index) || 0)),
        current: String(body.current ?? "").slice(0, 3000), lines, instruction: String(body.instruction ?? "more").slice(0, 200),
      }, sceneSeconds, totalSeconds);
      return NextResponse.json(result);
    }
    const suggestion = await suggestSound(env, images, sceneSeconds, totalSeconds);
    return NextResponse.json(suggestion);
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "The scenes could not be read.";
    if (/not connected/i.test(message)) return NextResponse.json({ error: message, fix: "cloudflare-ai" }, { status: 503 });
    return jsonError(error);
  }
}
