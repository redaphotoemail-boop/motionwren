import { requireAdmin } from "../../../../_lib/account";
import { trackAudio } from "../../../../_lib/music-library";

/* Plays a library track in the manager's page. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
    const object = await trackAudio(env, id);
    if (!object?.body) return Response.json({ error: "Not found." }, { status: 404 });
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
    if (range && (range[1] || range[2])) {
      const total = bytes.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(total - 1, Number(range[2])) : total - 1;
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(bytes, { headers: { ...headers, "Content-Length": String(bytes.length) } });
  } catch (error) { return error instanceof Response ? error : Response.json({ error: "Not found." }, { status: 404 }); }
}
