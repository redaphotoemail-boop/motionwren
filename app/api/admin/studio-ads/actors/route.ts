/* Studio Ads actors library: list (with photos) + create. Admin only.
   Actors are saved once and picked for many ads. */
import { enforceRateLimit, jsonError, requireAdmin } from "../../../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const actors = await env.DB.prepare(`SELECT id, name, notes, created_at AS createdAt, updated_at AS updatedAt FROM ad_actors WHERE owner_id = ? ORDER BY name`).bind(admin.id).all<{ id: string; name: string; notes: string; createdAt: number; updatedAt: number }>();
    const list = [];
    for (const actor of actors.results || []) {
      const photos = await env.DB.prepare(`SELECT id, angle, file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes, sort_order AS sortOrder, created_at AS createdAt FROM ad_actor_photos WHERE actor_id = ? AND owner_id = ? ORDER BY sort_order, created_at`).bind(actor.id, admin.id).all();
      list.push({ ...actor, photos: photos.results || [] });
    }
    return Response.json({ actors: list });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "studio-ads-actors-create", 30, 60 * 60 * 1000);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (name.length < 2) return Response.json({ error: "Give the actor a name (at least 2 characters)." }, { status: 400 });
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO ad_actors (id, owner_id, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, admin.id, name, notes, now, now).run();
    return Response.json({ actor: { id, name, notes, photos: [], createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
