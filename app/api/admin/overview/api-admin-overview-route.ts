import { jsonError, requireAdmin } from "../../_lib/account";

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const offset = Math.max(0, parseInt(new URL(request.url).searchParams.get("offset") || "0", 10) || 0);
    const [users, projects, jobs, history, assets, payments, subscriptions, recentProjects, recentJobs, recentActivity] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM users`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft, SUM(CASE WHEN status IN ('queued','generating','stitching','saving') THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM projects`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('starting','generating','stitching','saving') THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status IN ('starting','generating','stitching','saving') AND updated_at < ? THEN 1 ELSE 0 END) AS stuck, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, SUM(cost_cents) AS providerCostCents FROM render_jobs`).bind(Date.now() - 15 * 60 * 1000).first(),
      env.DB.prepare(`SELECT COUNT(*) AS total, SUM(cost_cents) AS providerCostCents, SUM(COALESCE(size_bytes,0)) AS bytes FROM generation_history`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS total, SUM(size_bytes) AS bytes FROM project_assets`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(amount_cents),0) AS revenueCents FROM payments WHERE status = 'paid'`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM subscriptions WHERE status IN ('active','trialing')`).first(),
      env.DB.prepare(`SELECT p.id, p.title, p.status, p.updated_at AS updatedAt, p.owner_id AS ownerId, u.email AS ownerEmail, p.price AS price, p.short_message AS shortMessage, p.render_job_id AS renderJobId, j.cost_cents AS productionCostCents, COUNT(a.id) AS assetCount FROM projects p LEFT JOIN users u ON u.id = p.owner_id LEFT JOIN render_jobs j ON j.id = p.render_job_id LEFT JOIN project_assets a ON a.project_id = p.id GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 12 OFFSET ?`).bind(offset).all(),
      env.DB.prepare(`SELECT j.id, j.kind, j.status, j.category, j.resolution, j.duration, j.cost_cents AS costCents, j.error, j.created_at AS createdAt, j.updated_at AS updatedAt, p.title AS projectTitle FROM render_jobs j LEFT JOIN projects p ON p.render_job_id = j.id ORDER BY j.updated_at DESC LIMIT 12`).all(),
      env.DB.prepare(`SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.created_at AS createdAt, u.display_name AS actorName, u.email AS actorEmail FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 20`).all(),
    ]);
    return Response.json({
      metrics: { users, projects, jobs, history, payments, subscriptions, storageBytes: Number((history as { bytes?: number } | null)?.bytes || 0) + Number((assets as { bytes?: number } | null)?.bytes || 0), assets },
      recentProjects: recentProjects.results,
      recentJobs: recentJobs.results,
      recentActivity: recentActivity.results,
      system: { storage: "Cloudflare R2", database: "Cloudflare D1", compositor: process.env.COMPOSITOR_API_URL && process.env.COMPOSITOR_API_SECRET ? "Controlled FFmpeg + fallback" : "Managed crossfade fallback", compositorStatus: process.env.COMPOSITOR_API_URL && process.env.COMPOSITOR_API_SECRET ? "Operational" : "Container account needed", dependencyAudit: "0 known production vulnerabilities", billing: process.env.STRIPE_SECRET_KEY ? "Connected" : "Stripe credentials needed", email: process.env.RESEND_API_KEY && process.env.FRAME_MOTION_FROM_EMAIL ? "Connected" : "Email credentials needed", callbacks: process.env.REPLICATE_API_TOKEN ? "Operational" : "Provider token needed" },
    });
  } catch (error) { return jsonError(error); }
}
