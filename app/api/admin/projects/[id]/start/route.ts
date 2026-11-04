import { HttpError, audit, jsonError, requireAdmin } from "../../../../_lib/account";
import { startOrder } from "../../../../_lib/customer-production";

/* Manager only: start production of a customer's order that is waiting for
   approval (or start a failed one again). Same production path as when the
   customer starts it; the video is the customer's. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const providerToken = process.env.REPLICATE_API_TOKEN;
    if (!providerToken) return Response.json({ error: "The video engine is not connected yet." }, { status: 503 });
    const project = await env.DB.prepare(`SELECT id, owner_id AS ownerId, title, status, aspect, resolution, target_duration AS targetDuration, render_job_id AS renderJobId FROM projects WHERE id = ? LIMIT 1`).bind(id).first<{ id: string; ownerId: string; title: string; status: string; aspect: string; resolution: string; targetDuration: number; renderJobId: string | null }>();
    if (!project) return Response.json({ error: "Order not found." }, { status: 404 });
    if (!["approval", "submitted", "failed"].includes(project.status)) throw new HttpError(409, "This order is already in production or finished.");
    const result = await startOrder(env, project, project.ownerId, new URL(request.url).origin, providerToken);
    await audit(env, admin.id, "project.production_started", "project", id);
    return Response.json(result, { status: 202 });
  } catch (error) { return jsonError(error); }
}
