import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  const requestedName = new URL(request.url).searchParams.get("name") || "frame-motion-video.mp4";
  if (!source) return NextResponse.json({ error: "Missing video URL." }, { status: 400 });
  try {
    const url = new URL(source);
    const allowed = url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery"));
    if (!allowed) return NextResponse.json({ error: "This download source is not allowed." }, { status: 400 });
    const upstream = await fetch(url.toString());
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "The video file is no longer available." }, { status: 502 });
    const filename = requestedName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100);
    return new NextResponse(upstream.body, { headers: {
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      "Content-Disposition": `attachment; filename="${filename.endsWith(".mp4") ? filename : filename + ".mp4"}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch { return NextResponse.json({ error: "The video could not be downloaded." }, { status: 500 }); }
}
