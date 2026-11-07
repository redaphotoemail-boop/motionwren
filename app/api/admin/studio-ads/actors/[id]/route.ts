/* Studio Ads: delete an actor (with its photos, from storage too). Admin only. */
import { jsonError, requireAdmin } from "../../../../_lib/account";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const actor = await env.DB.prepare(`SELECT id FROM ad_actors WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, admin.id).first();
    if (!actor) return Response.json({ error: "Actor not found." }, { status: 404 });
    const photos = await env.DB.prepare(`SELECT r2_key AS r2Key FROM ad_actor_photos WHERE actor_id = ? AND owner_id = ?`).bind(id, admin.id).all<{ r2Key: string }>();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ad_actor_photos WHERE actor_id = ? AND owner_id = ?`).bind(id, admin.id),
      env.DB.prepare(`DELETE FROM ad_project_actors WHERE actor_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM ad_actors WHERE id = ? AND owner_id = ?`).bind(id, admin.id),
    ]);
    await Promise.allSettled((photos.results || []).map((photo) => env.BUCKET.delete(photo.r2Key)));
    return Response.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
