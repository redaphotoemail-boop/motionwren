/* One photo for a template's preview clip: sent as the request body (an
   image), kept briefly in storage, and turned into a linkable key. */
import { jsonError, requireAdmin } from "../../../_lib/account";

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const type = (request.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return Response.json({ error: "Choose a JPG, PNG or WebP photo." }, { status: 400 });
    const data = await request.arrayBuffer();
    if (data.byteLength < 2000 || data.byteLength > 20 * 1024 * 1024) return Response.json({ error: "Choose a photo under 20 MB." }, { status: 413 });
    const key = `wrencut/photo-${crypto.randomUUID()}`;
    await env.BUCKET.put(key, data, { httpMetadata: { contentType: type } });
    return Response.json({ key });
  } catch (error) { return jsonError(error); }
}
