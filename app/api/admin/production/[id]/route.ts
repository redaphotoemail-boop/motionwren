import { jsonError, requireAdmin } from "../../../_lib/account";
import { getRenderJob, jobScenes, publicJob, runJobAction, startOverJob } from "../../../_lib/render-jobs";
import type { JobAction } from "../../../_lib/scene-queue";

/* Manager actions on any video (a client's order or a Studio video):
   resume, retry one scene, regenerate one scene, re-join, start over.
   Each goes through the scene queue with its lease and "being sent" marks,
   so a double click never creates duplicate engine jobs or charges. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return Response.json({ error: "The video engine key is not set on the server." }, { status: 503 });
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await getRenderJob(env, id) : null;
    if (!row) return Response.json({ error: "Video not found." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { action?: string; scene?: unknown };
    const origin = new URL(request.url).origin;
    if (body.action === "start-over") {
      const result = await startOverJob(env, row, token, origin);
      if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
      return Response.json({ replaced: id, id: result.id });
    }
    if (!["resume", "retry-scene", "regenerate-scene", "reassemble"].includes(String(body.action))) return Response.json({ error: "Unknown action." }, { status: 400 });
    const scene = Number.isInteger(body.scene) ? Number(body.scene) : null;
    const webhook = row.webhookToken ? `${origin}/api/webhooks/replicate/${id}?token=${row.webhookToken}` : undefined;
    const result = await runJobAction(env, row, body.action as JobAction, scene, token, webhook);
    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
    const fresh = await getRenderJob(env, id);
    return Response.json({ redo: result.redo, job: fresh ? { ...publicJob(fresh), scenes: await jobScenes(env, fresh) } : null });
  } catch (error) { return jsonError(error); }
}
