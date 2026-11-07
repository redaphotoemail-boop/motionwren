/* Studio Ads: upload a photo of an actor — face, silhouette, or an angle.
   Same image rules as source uploads. Actor photos never expire: the
   library is permanent until the actor is deleted. Admin only. */
import { audit, enforceRateLimit, jsonError, requireAdmin } from "../../../../../_lib/account";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ANGLES = new Set(["front", "side", "three-quarter", "silhouette", "other"]);

function isImage(head: Uint8Array, type: string) {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (type === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (type === "image/png") return head[0] === 0x89 && ascii(1, 4) === "PNG";
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: actorId } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "studio-ads-actor-photo-upload", 120, 60 * 60 * 1000);
    const actor = await env.DB.prepare(`SELECT id FROM ad_actors WHERE id = ? AND owner_id = ? LIMIT 1`).bind(actorId, admin.id).first();
    if (!actor) return Response.json({ error: "Actor not found." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    const angle = typeof form.get("angle") === "string" && ANGLES.has(form.get("angle") as string) ? (form.get("angle") as string) : "front";
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Upload a JPG, PNG or WebP image." }, { status: 400 });
    if (!file.size || file.size > MAX_ASSET_BYTES) return Response.json({ error: "Each image must be smaller than 20 MB." }, { status: 413 });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ad_actor_photos WHERE actor_id = ? AND owner_id = ?`).bind(actorId, admin.id).first<{ count: number }>();
    if ((count?.count || 0) >= 8) return Response.json({ error: "An actor can have up to 8 photos." }, { status: 409 });
    const bytes = await file.arrayBuffer();
    if (!isImage(new Uint8Array(bytes.slice(0, 12)), file.type)) return Response.json({ error: "Upload a JPG, PNG or WebP image." }, { status: 400 });
    const photoId = crypto.randomUUID();
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const r2Key = `ad-actors/${admin.id}/${actorId}/${photoId}.${extension}`;
    const now = Date.now();
    const sortOrder = count?.count || 0;
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { ownerId: admin.id, actorId, originalName: file.name.slice(0, 120) } });
    try {
      await env.DB.prepare(`INSERT INTO ad_actor_photos (id, actor_id, owner_id, angle, r2_key, file_name, content_type, size_bytes, sort_order, provider_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).bind(photoId, actorId, admin.id, angle, r2Key, file.name.slice(0, 180), file.type, file.size, sortOrder, now).run();
    } catch (error) { await env.BUCKET.delete(r2Key); throw error; }
    await audit(env, admin.id, "studio-ads.actor.photo.uploaded", "ad_actor", actorId, { photoId, angle, sizeBytes: file.size });
    return Response.json({ photo: { id: photoId, angle, fileName: file.name, contentType: file.type, sizeBytes: file.size, sortOrder, createdAt: now } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
