import { anyTrackId, trackAudio } from "../../_lib/music-library";
import { musicTemplate, sampleKey } from "../../../music-catalog";

/* The short sample of a music template, for the plan's play buttons. Public
   on purpose: customers hear it before they have an account. Honors Range
   requests because Safari will not play audio without them. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!musicTemplate(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  let object = await env.BUCKET.get(sampleKey(id));
  // No sample made yet: let the customer hear one of the library's tracks of that style.
  if (!object?.body) { const kept = await anyTrackId(env, id).catch(() => null); if (kept) object = await trackAudio(env, kept); }
  if (!object?.body) return Response.json({ error: "This sample is not ready yet." }, { status: 404 });
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (range && (range[1] || range[2])) {
    const total = bytes.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(total - 1, Number(range[2])) : total - 1;
    if (start > end || start >= total) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(bytes, { headers: { ...headers, "Content-Length": String(bytes.length) } });
}
