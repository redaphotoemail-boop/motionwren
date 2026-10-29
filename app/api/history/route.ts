import { NextResponse } from "next/server";
import { requireAdmin } from "../_lib/account";
import { HISTORY_COOKIE as COOKIE, historyOwnerIds, uploadBody } from "../_lib/history-owners";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function safeVideoUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery")) ? url : null;
  } catch { return null; }
}


export async function GET() {
  const { env } = await import("cloudflare:workers");
  const ownerIds = await historyOwnerIds(env);
  if (!ownerIds.length) return NextResponse.json({ items: [] });
  const placeholders = ownerIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`SELECT id, prompt, engine, category, resolution, aspect, duration, cost_cents AS costCents, created_at AS createdAt FROM generation_history WHERE owner_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`).bind(...ownerIds).all();
  return NextResponse.json({ items: result.results.map((item) => ({ ...item, videoUrl: `/api/history/${item.id}/video`, downloadUrl: `/api/history/${item.id}/video?download=1` })) });
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAdmin(env);
    const requestType = request.headers.get("content-type") || "";
    const isUpload = requestType.includes("multipart/form-data");
    const isRawVideo = requestType.startsWith("video/");
    let body: Record<string, unknown>; let bytes: ArrayBuffer | ReadableStream; let size = 0; let contentType = "video/mp4";
    if (isRawVideo) {
      // The Studio sends the finished video as the request body, with its
      // details in a header: a form upload over 21 MB is refused before it
      // reaches this route, and streaming avoids holding 100 MB in memory.
      size = Number(request.headers.get("content-length")) || 0;
      if (!size || size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "This video is too large to save in history." }, { status: 413 });
      try { body = JSON.parse(decodeURIComponent(request.headers.get("x-motionwren-meta") || "%7B%7D")) as Record<string, unknown>; } catch { body = {}; }
      contentType = requestType.split(";")[0] || "video/mp4";
      bytes = await uploadBody(request, size);
    } else if (isUpload) {
      const form = await request.formData(); const video = form.get("video");
      if (!(video instanceof File) || !video.type.startsWith("video/")) return NextResponse.json({ error: "The finished video file is not valid." }, { status: 400 });
      bytes = await video.arrayBuffer(); size = bytes.byteLength; contentType = video.type || "video/webm";
      body = Object.fromEntries(["prompt","engine","category","resolution","aspect","duration","costCents"].map((key) => [key, String(form.get(key) || "")]));
    } else {
      body = await request.json() as Record<string, unknown>; const source = safeVideoUrl(body.sourceUrl);
      if (!source) return NextResponse.json({ error: "The generated video source is not valid." }, { status: 400 });
      const upstream = await fetch(source.toString());
      if (!upstream.ok) return NextResponse.json({ error: "The generated video could not be saved." }, { status: 502 });
      bytes = await upstream.arrayBuffer(); size = bytes.byteLength; contentType = upstream.headers.get("content-type") || "video/mp4";
    }
    if (!size || size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "This video is too large to save in history." }, { status: 413 });

    const ownerId = account.id;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const extension = contentType.includes("webm") ? "webm" : "mp4";
    const r2Key = `generation-history/${ownerId}/${id}.${extension}`;
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType } });

    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6000) : "";
    const validEngines = new Set(["kling3", "geminiOmni", "veo31Lite", "hailuo23", "runway45", "wan22", "wan25", "wan27", "wan3", "seedance1fast", "studio", "fast"]);
    const requestedEngine = typeof body.engine === "string" ? body.engine : "wan22";
    const engine = validEngines.has(requestedEngine) ? requestedEngine : "wan22";
    const category = typeof body.category === "string" ? body.category.slice(0, 40) : "single";
    const resolution = typeof body.resolution === "string" ? body.resolution.slice(0, 20) : "480p";
    const aspect = typeof body.aspect === "string" ? body.aspect.slice(0, 20) : "horizontal";
    const duration = Math.max(1, Math.min(600, Math.round(Number(body.duration) || 5)));
    const costCents = Math.max(0, Math.min(10000, Math.round(Number(body.costCents) || 0)));
    try {
      await env.DB.prepare(`INSERT INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, ownerId, r2Key, prompt, engine, category, resolution, aspect, duration, costCents, size, createdAt).run();
    } catch (error) {
      await env.BUCKET.delete(r2Key);
      throw error;
    }

    const response = NextResponse.json({ item: { id, prompt, engine, category, resolution, aspect, duration, costCents, createdAt, videoUrl: `/api/history/${id}/video`, downloadUrl: `/api/history/${id}/video?download=1` } });
    response.cookies.set(COOKIE, ownerId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch {
    return NextResponse.json({ error: "The generated video could not be added to history." }, { status: 500 });
  }
}
