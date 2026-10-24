import { jsonError, requireAdmin } from "../../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const result = await env.DB.prepare(`
      SELECT
        u.id,
        u.email,
        u.display_name AS displayName,
        u.role,
        u.status,
        u.plan,
        u.credit_balance AS creditBalance,
        u.created_at AS createdAt,
        u.updated_at AS updatedAt,
        COUNT(DISTINCT p.id) AS projectCount,
        SUM(CASE WHEN p.status IN ('submitted','queued','generating','stitching','saving') THEN 1 ELSE 0 END) AS activeProjects,
        SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS deliveredProjects,
        MAX(p.updated_at) AS lastProjectAt
      FROM users u
      LEFT JOIN projects p ON p.owner_id = u.id
      GROUP BY u.id
      ORDER BY COALESCE(MAX(p.updated_at), u.updated_at) DESC
      LIMIT 250
    `).all();
    return Response.json({ customers: result.results });
  } catch (error) { return jsonError(error); }
}
