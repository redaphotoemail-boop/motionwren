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
  const serve = async (r2Key: string, contentType: string) => {
    const object = await env.BUCKET.get(r2Key);
    if (!object?.body) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    return new Response(object.body, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  };
  const asset = await env.DB.prepare(`SELECT a.r2_key AS r2Key, a.content_type AS contentType, a.provider_token AS providerToken, p.status FROM project_assets a JOIN projects p ON p.id = a.project_id WHERE a.id = ? LIMIT 1`).bind(assetId).first<{ r2Key: string; contentType: string; providerToken: string | null; status: string }>();
  if (asset?.providerToken && safeEqual(asset.providerToken, supplied) && ["submitted", "queued", "generating", "stitching", "saving"].includes(asset.status)) return serve(asset.r2Key, asset.contentType);
  // Studio Ads: an ad's source images, then an actor photo used by an ad
  // that is currently generating (same token check, same short-lived link).
  const adAsset = await env.DB.prepare(`SELECT a.r2_key AS r2Key, a.content_type AS contentType, a.provider_token AS providerToken, p.status FROM ad_assets a JOIN ad_projects p ON p.id = a.ad_project_id WHERE a.id = ? LIMIT 1`).bind(assetId).first<{ r2Key: string; contentType: string; providerToken: string | null; status: string }>();
  if (adAsset?.providerToken && safeEqual(adAsset.providerToken, supplied) && ["queued", "generating", "stitching", "saving"].includes(adAsset.status)) return serve(adAsset.r2Key, adAsset.contentType);
  const actorPhoto = await env.DB.prepare(`SELECT a.r2_key AS r2Key, a.content_type AS contentType, a.provider_token AS providerToken FROM ad_actor_photos a JOIN ad_project_actors l ON l.actor_id = a.actor_id JOIN ad_projects p ON p.id = l.ad_project_id WHERE a.id = ? AND p.status IN ('queued', 'generating', 'stitching', 'saving') ORDER BY p.updated_at DESC LIMIT 1`).bind(assetId).first<{ r2Key: string; contentType: string; providerToken: string | null }>();
  if (actorPhoto?.providerToken && safeEqual(actorPhoto.providerToken, supplied)) return serve(actorPhoto.r2Key, actorPhoto.contentType);
  return NextResponse.json({ error: "Asset access expired." }, { status: 403 });
}
