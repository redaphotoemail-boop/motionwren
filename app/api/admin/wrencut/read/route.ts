/* Starts reading a reference video: either a file sent as the request body
   (video/*) or a direct link in JSON. Social-site pages (TikTok, Instagram,
   CapCut) are not video files and usually cannot be fetched, so the page
   says so up front instead of failing later. */
import { jsonError, requireAdmin } from "../../../_lib/account";
import { uploadBody } from "../../../_lib/history-owners";
import { fileLink, referenceKey, startRead } from "../../../_lib/wrencut";

const MAX_BYTES = 300 * 1024 * 1024;
const SOCIAL = /(^|\.)(tiktok\.com|instagram\.com|capcut\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch)$/i;

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const job = crypto.randomUUID().replaceAll("-", "");
    const origin = new URL(request.url).origin;
    const type = request.headers.get("content-type") || "";
    if (type.startsWith("video/")) {
      const size = Number(request.headers.get("content-length")) || 0;
      if (!size || size > MAX_BYTES) return Response.json({ error: "Choose a video under 300 MB." }, { status: 413 });
      const key = referenceKey(job);
      await env.BUCKET.put(key, await uploadBody(request, size), { httpMetadata: { contentType: type.split(";")[0] } });
      await startRead(env, job, await fileLink(env, origin, key), key);
      return Response.json({ job });
    }
    const body = await request.json().catch(() => ({})) as { url?: unknown };
    let link: URL;
    try { link = new URL(String(body.url || "").trim()); } catch { return Response.json({ error: "Paste a link to the video file, or upload the video." }, { status: 400 }); }
    if (link.protocol !== "https:" && link.protocol !== "http:") return Response.json({ error: "Paste a link to the video file, or upload the video." }, { status: 400 });
    if (SOCIAL.test(link.hostname)) return Response.json({ error: "TikTok, Instagram and CapCut pages cannot be downloaded from here. Save the video (or screen-record it) and upload the file instead.", social: true }, { status: 422 });
    await startRead(env, job, link.toString());
    return Response.json({ job });
  } catch (error) { return jsonError(error); }
}
