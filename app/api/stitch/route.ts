import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const STITCH_VERSION = "03c0802dc63ff01bb16f967f9ce4d7a784cbb697e9e7a593dd5f08bb83807ced";

function isAllowedVideoUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery") || url.hostname === "replicate.com" || url.hostname.endsWith(".replicate.com"));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "The Replicate API token has not been connected yet." }, { status: 503 });

  try {
    const body = await request.json();
    const videos = Array.isArray(body.videos) ? body.videos : [];
    if (videos.length < 2 || videos.length > 15 || !videos.every(isAllowedVideoUrl)) {
      return NextResponse.json({ error: "Two to fifteen completed Replicate video clips are required for assembly." }, { status: 400 });
    }

    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ version: STITCH_VERSION, input: { videos } }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json({ error: (data.detail as string) || (data.error as string) || "Replicate could not assemble the clips." }, { status: response.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "The final video assembly request could not be processed." }, { status: 500 });
  }
}
