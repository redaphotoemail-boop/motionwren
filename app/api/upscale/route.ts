import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const ENDPOINT = "https://api.replicate.com/v1/models/topazlabs/video-upscale/predictions";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "Connect Replicate before upscaling a video." }, { status: 503 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const video = String(body.video || "");
    if (!video.startsWith("data:video/") || video.length > 30_000_000) return NextResponse.json({ error: "Choose an MP4, MOV or WebM video under 20 MB." }, { status: 400 });
    const targetResolution = body.targetResolution === "4k" ? "4k" : "1080p";
    const targetFps = body.targetFps === 60 ? 60 : 30;
    const response = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=25" }, body: JSON.stringify({ input: { video, target_resolution: targetResolution, target_fps: targetFps } }) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: (data.detail as string) || "The upscaler rejected this video." }, { status: response.status });
    return NextResponse.json(data);
  } catch { return NextResponse.json({ error: "The upscale request could not be processed." }, { status: 500 }); }
}
