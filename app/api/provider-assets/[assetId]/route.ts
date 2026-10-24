import { NextResponse } from "next/server";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const supplied = new URL(request.url).searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(assetId) || supplied.length < 48) return NextResponse.json({ error: "Invalid asset request." }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  const asset = await env.DB.prepare(`SELECT a.r2_key AS r2Key, a.content_type AS contentType, a.provider_token AS providerToken, p.status FROM project_assets a JOIN projects p ON p.id = a.project_id WHERE a.id = ? LIMIT 1`).bind(assetId).first<{ r2Key: string; contentType: string; providerToken: string | null; status: string }>();
  if (!asset?.providerToken || !safeEqual(asset.providerToken, supplied) || !["submitted", "queued", "generating", "stitching", "saving"].includes(asset.status)) return NextResponse.json({ error: "Asset access expired." }, { status: 403 });
  const object = await env.BUCKET.get(asset.r2Key);
  if (!object?.body) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": asset.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
