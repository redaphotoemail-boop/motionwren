/* A template's preview clip (made from real footage), for its tile. Byte
   ranges are answered so iPhone Safari plays it. */
import { previewKey } from "../../../_lib/wrencut";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const ranged = Boolean(request.headers.get("range"));
  const object = ranged ? await env.BUCKET.get(previewKey(id), { range: request.headers }) : await env.BUCKET.get(previewKey(id));
  if (!object) return Response.json({ error: "Not found." }, { status: 404 });
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=300" };
  const range = ranged ? (object as { range?: { offset?: number; length?: number; suffix?: number } }).range : undefined;
  if (range && object.size) {
    const start = range.suffix !== undefined ? Math.max(0, object.size - range.suffix) : range.offset || 0;
    const length = range.suffix !== undefined ? object.size - start : range.length ?? object.size - start;
    const end = Math.min(object.size - 1, start + length - 1);
    headers["Content-Range"] = `bytes ${start}-${end}/${object.size}`;
    headers["Content-Length"] = String(end - start + 1);
    return new Response(object.body, { status: 206, headers });
  }
  headers["Content-Length"] = String(object.size);
  return new Response(object.body, { headers });
}
