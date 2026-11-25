import { requireAccount } from "../../../../_lib/account";
import { loadManifest } from "../../../../_lib/production";

/* A client's own film parts, for their editor: a scene's photo, its clip in the film, or an earlier version of it.
   Only the project's owner can open them. */
export async function GET(request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^(scene-\d{2}\.jpg|out-\d{2}\.mp4|take-\d{2}-\d{1,2}\.mp4)$/.test(file)) return Response.json({ error: "Not found." }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  let ownerId = "";
  try { ownerId = (await requireAccount(env)).id; } catch { return Response.json({ error: "Not found." }, { status: 404 }); }
  const project = await env.DB.prepare(`SELECT render_job_id AS jobId FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, ownerId).first<{ jobId: string | null }>();
  if (!project?.jobId) return Response.json({ error: "Not found." }, { status: 404 });
  let key = `render-jobs/${project.jobId}/${file}`;
  // A scene's photo is kept with the project's photos until the film's first edit copies it next to the scenes.
  if (file.startsWith("scene-") && !(await env.BUCKET.head(key))) {
    const manifest = await loadManifest(env, project.jobId);
    const photo = manifest?.photos?.[Number(file.slice(6, 8)) - 1];
    if (photo?.key) key = photo.key;
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") || "");
  if (range && file.endsWith(".mp4")) {
    const head = await env.BUCKET.head(key);
    if (!head) return Response.json({ error: "Not found." }, { status: 404 });
    const start = Math.min(Number(range[1]), Math.max(0, head.size - 1));
    const end = Math.min(range[2] ? Number(range[2]) : head.size - 1, head.size - 1);
    const part = await env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!part?.body) return Response.json({ error: "Not found." }, { status: 404 });
    return new Response(part.body, { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${head.size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600" } });
  }
  const object = await env.BUCKET.get(key);
  if (!object?.body) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || (file.endsWith(".mp4") ? "video/mp4" : "image/jpeg"), "Cache-Control": "private, max-age=600", "Accept-Ranges": "bytes" } });
}
