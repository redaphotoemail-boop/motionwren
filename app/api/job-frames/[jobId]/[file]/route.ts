import { requireAdmin } from "../../../_lib/account";

/* Serves a scene's photo, our copy of a finished scene, or the film's music. The engine gets a link carrying the job's
   private webhook token; the owner who started the job can also see it (the
   Studio shows each scene's photo while the video is being made). */
export async function GET(request: Request, context: { params: Promise<{ jobId: string; file: string }> }) {
  const { jobId, file } = await context.params;
  const token = new URL(request.url).searchParams.get("token") || "";
  // scene-NN.jpg: a scene's photo · out-NN.mp4: our copy of a finished scene · music.mp3: the film's one music track (for the edit)
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^(scene-\d{2}\.jpg|out-\d{2}\.mp4|music\.mp3|composed\.mp4)$/.test(file)) return Response.json({ error: "Not found." }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  const row = await env.DB.prepare(`SELECT owner_id AS ownerId, webhook_token AS webhookToken FROM render_jobs WHERE id = ? LIMIT 1`).bind(jobId).first<{ ownerId: string; webhookToken: string | null }>();
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });
  let allowed = token.length >= 48 && Boolean(row.webhookToken) && row.webhookToken === token;
  if (!allowed && !token) {
    try { allowed = (await requireAdmin(env)).id === row.ownerId; } catch { allowed = false; }
  }
  if (!allowed) return Response.json({ error: "Not found." }, { status: 404 });
  const object = await env.BUCKET.get(`render-jobs/${jobId}/${file}`);
  if (!object?.body) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || (file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".mp3") ? "audio/mpeg" : "image/jpeg"), "Cache-Control": "private, max-age=3600" } });
}
