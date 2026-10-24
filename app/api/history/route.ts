import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE = "fm_history_id";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function safeVideoUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery")) ? url : null;
  } catch { return null; }
}

async function owner() {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE)?.value || crypto.randomUUID();
}

export async function GET() {
  const { env } = await import("cloudflare:workers");
  const cookieStore = await cookies();
  const ownerId = cookieStore.get(COOKIE)?.value;
  if (!ownerId) return NextResponse.json({ items: [] });
  const result = await env.DB.prepare(`SELECT id, prompt, engine, category, resolution, aspect, duration, cost_cents AS costCents, created_at AS createdAt FROM generation_history WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50`).bind(ownerId).all();
  return NextResponse.json({ items: result.results.map((item) => ({ ...item, videoUrl: `/api/history/${item.id}/video`, downloadUrl: `/api/history/${item.id}/video?download=1` })) });
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const body = await request.json() as Record<string, unknown>;
    const source = safeVideoUrl(body.sourceUrl);
    if (!source) return NextResponse.json({ error: "The generated video source is not valid." }, { status: 400 });
    const upstream = await fetch(source.toString());
    if (!upstream.ok) return NextResponse.json({ error: "The generated video could not be saved." }, { status: 502 });
    const bytes = await upstream.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_VIDEO_BYTES) return NextResponse.json({ error: "This video is too large to save in history." }, { status: 413 });

    const ownerId = await owner();
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const r2Key = `generation-history/${ownerId}/${id}.mp4`;
    const contentType = upstream.headers.get("content-type") || "video/mp4";
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType } });

    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6000) : "";
    const allowedEngines = new Set(["wan22", "wan25", "wan26flash", "wan26", "wan3", "seedance25", "seedance15", "runway45", "runway4turbo", "minimaxh3", "geminiomni", "kling3"]);
    const engine = typeof body.engine === "string" && allowedEngines.has(body.engine) ? body.engine : "wan22";
    const category = typeof body.category === "string" ? body.category.slice(0, 40) : "single";
    const resolution = typeof body.resolution === "string" ? body.resolution.slice(0, 20) : "480p";
    const aspect = typeof body.aspect === "string" ? body.aspect.slice(0, 20) : "horizontal";
    const requestedDuration = Math.round(Number(body.duration) || 5);
    const duration = Math.max(3, Math.min(120, requestedDuration));
    const costCents = Math.max(0, Math.min(10000, Math.round(Number(body.costCents) || 0)));
    try {
      await env.DB.prepare(`INSERT INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, ownerId, r2Key, prompt, engine, category, resolution, aspect, duration, costCents, createdAt).run();
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
