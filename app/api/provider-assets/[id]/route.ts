import { NextResponse } from "next/server";

/* Serves one uploaded listing photo to the video provider.
   The generate path hands Replicate URLs of the form
   /api/provider-assets/<assetId>?token=<providerToken>, where the token is
   the per-asset random token set at generate time. The token is the only
   authorization here (Replicate fetches unauthenticated), so a missing,
   mismatched, or absent token gets the same 404 as an unknown photo. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || token.length < 32) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  const { env } = await import("cloudflare:workers");
  const row = await env.DB.prepare(
    `SELECT r2_key AS r2Key, content_type AS contentType, provider_token AS providerToken FROM project_assets WHERE id = ? LIMIT 1`
  ).bind(id).first<{ r2Key: string; contentType: string; providerToken: string | null }>();
  if (!row || !row.providerToken || row.providerToken !== token) {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  const object = await env.BUCKET.get(row.r2Key);
  if (!object) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  return new NextResponse(object.body, {
    headers: {
      "Content-Type": row.contentType || object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
