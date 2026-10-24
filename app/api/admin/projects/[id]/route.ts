import { audit, jsonError, requireAdmin } from "../../../_lib/account";

const MAX_DELIVERY_BYTES = 100 * 1024 * 1024;
const STATUSES = new Set(["submitted", "queued", "generating", "editing", "review", "completed", "failed", "cancelled"]);

type ProjectRow = {
  id: string;
  ownerId: string;
  title: string;
  status: string;
  resolution: string;
  aspect: string;
};

async function projectById(env: { DB: D1Database }, id: string) {
  return env.DB.prepare(`SELECT p.id, p.owner_id AS ownerId, p.title, p.status, p.listing_url AS listingUrl, p.listing_address AS listingAddress, p.beds, p.baths, p.square_feet AS squareFeet, p.price, p.short_message AS shortMessage, p.aspect, p.resolution, p.generation_engine AS generationEngine, p.target_duration AS targetDuration, p.agent_name AS agentName, p.agent_email AS agentEmail, p.agent_phone AS agentPhone, p.final_history_id AS finalHistoryId, p.created_at AS createdAt, p.updated_at AS updatedAt, u.email AS customerEmail, u.display_name AS customerName FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ? LIMIT 1`).bind(id).first<ProjectRow & Record<string, unknown>>();
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const project = await projectById(env, id);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const assets = await env.DB.prepare(`SELECT id, file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes, sort_order AS sortOrder, created_at AS createdAt FROM project_assets WHERE project_id = ? ORDER BY sort_order, created_at`).bind(id).all();
    return Response.json({ project: { ...project, assets: assets.results } });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const body = await request.json() as { status?: string };
    if (!body.status || !STATUSES.has(body.status)) return Response.json({ error: "Choose a valid production status." }, { status: 400 });
    const project = await projectById(env, id);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    await env.DB.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`).bind(body.status, Date.now(), id).run();
    await audit(env, admin.id, "project.status_changed", "project", id, { from: project.status, to: body.status });
    return Response.json({ ok: true, status: body.status });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const project = await projectById(env, id);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const form = await request.formData();
    const video = form.get("video");
    if (!(video instanceof File) || !video.type.startsWith("video/")) return Response.json({ error: "Upload the completed MP4 or WebM video." }, { status: 400 });
    if (!video.size || video.size > MAX_DELIVERY_BYTES) return Response.json({ error: "The delivery file must be smaller than 100 MB." }, { status: 413 });
    const historyId = crypto.randomUUID();
    const extension = video.type.includes("webm") ? "webm" : "mp4";
    const r2Key = `generation-history/${project.ownerId}/${historyId}.${extension}`;
    const now = Date.now();
    await env.BUCKET.put(r2Key, await video.arrayBuffer(), { httpMetadata: { contentType: video.type || "video/mp4" }, customMetadata: { projectId: id, deliveredBy: admin.id } });
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, created_at) VALUES (?, ?, ?, ?, 'delivered', 'real-estate', ?, ?, 0, 0, ?, ?)`).bind(historyId, project.ownerId, r2Key, `Final delivery for ${project.title}`, project.resolution, project.aspect, video.size, now),
        env.DB.prepare(`UPDATE projects SET status = 'completed', final_history_id = ?, updated_at = ? WHERE id = ?`).bind(historyId, now, id),
        env.DB.prepare(`INSERT INTO notifications (id, owner_id, type, title, message, created_at) VALUES (?, ?, 'delivery.ready', ?, ?, ?)`).bind(crypto.randomUUID(), project.ownerId, "Your video is ready", `${project.title} is ready to preview and download.`, now),
      ]);
    } catch (error) {
      await env.BUCKET.delete(r2Key);
      throw error;
    }
    await audit(env, admin.id, "project.delivered", "project", id, { historyId, sizeBytes: video.size });
    return Response.json({ ok: true, historyId, status: "completed" }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
