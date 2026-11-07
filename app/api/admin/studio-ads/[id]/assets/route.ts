/* Studio Ads: upload a source image (the images the video is made from).
   Same rules as the customer asset upload: JPG/PNG/WebP, 20 MB, magic-byte
   checked, 20 per ad. Same R2 bucket, its own prefix: ad-assets/. Admin only. */
import { audit, enforceRateLimit, jsonError, requireAdmin } from "../../../../_lib/account";
import { loadAd } from "../../../../_lib/ads-production";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isImage(head: Uint8Array, type: string) {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (type === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (type === "image/png") return head[0] === 0x89 && ascii(1, 4) === "PNG";
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: adId } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "studio-ads-asset-upload", 120, 60 * 60 * 1000);
    const ad = await loadAd(env, adId, admin.id);
    if (!ad) return Response.json({ error: "Ad not found." }, { status: 404 });
    if (["queued", "generating", "stitching", "saving"].includes(ad.status)) return Response.json({ error: "This ad is being made. Wait for it to finish before adding images." }, { status: 409 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Upload a JPG, PNG or WebP image." }, { status: 400 });
    if (!file.size || file.size > MAX_ASSET_BYTES) return Response.json({ error: "Each image must be smaller than 20 MB." }, { status: 413 });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ad_assets WHERE ad_project_id = ? AND owner_id = ?`).bind(adId, admin.id).first<{ count: number }>();
    if ((count?.count || 0) >= 20) return Response.json({ error: "An ad can contain up to 20 source images." }, { status: 409 });
    const bytes = await file.arrayBuffer();
    if (!isImage(new Uint8Array(bytes.slice(0, 12)), file.type)) return Response.json({ error: "Upload a JPG, PNG or WebP image." }, { status: 400 });
    const assetId = crypto.randomUUID();
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const r2Key = `ad-assets/${admin.id}/${adId}/${assetId}.${extension}`;
    const now = Date.now();
    const sortOrder = count?.count || 0;
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { ownerId: admin.id, adProjectId: adId, originalName: file.name.slice(0, 120) } });
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO ad_assets (id, ad_project_id, owner_id, kind, r2_key, file_name, content_type, size_bytes, sort_order, provider_token, expires_at, created_at) VALUES (?, ?, ?, 'source', ?, ?, ?, ?, ?, NULL, ?, ?)`).bind(assetId, adId, admin.id, r2Key, file.name.slice(0, 180), file.type, file.size, sortOrder, now + 90 * 24 * 60 * 60 * 1000, now),
        env.DB.prepare(`UPDATE ad_projects SET updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, adId, admin.id),
      ]);
    } catch (error) { await env.BUCKET.delete(r2Key); throw error; }
    await audit(env, admin.id, "studio-ads.asset.uploaded", "ad_project", adId, { assetId, sizeBytes: file.size });
    return Response.json({ asset: { id: assetId, fileName: file.name, contentType: file.type, sizeBytes: file.size, sortOrder, createdAt: now } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
