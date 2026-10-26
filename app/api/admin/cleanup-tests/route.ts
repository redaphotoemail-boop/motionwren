import { audit, jsonError, requireAdmin } from "../../_lib/account";

/* Deletes the manager's own draft and failed test projects, and nothing
   else. Drafts have no jobs; failed projects have jobs whose history is
   empty (history rows are only created for successful deliveries), so
   removing each project's render job clears the attention banner and the
   recorded cost totals. Real client orders are untouched: the scope is
   owner_id = the admin's own account AND status in draft/failed. */
export async function POST() {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const projects = await env.DB.prepare(
      `SELECT id, render_job_id AS renderJobId FROM projects WHERE owner_id = ? AND status IN ('draft', 'failed')`
    ).bind(admin.id).all<{ id: string; renderJobId: string | null }>();
    let deletedAssets = 0;
    for (const project of projects.results) {
      const assets = await env.DB.prepare(
        `SELECT r2_key AS r2Key FROM project_assets WHERE project_id = ? AND owner_id = ?`
      ).bind(project.id, admin.id).all<{ r2Key: string }>();
      await Promise.all(assets.results.map((asset) => env.BUCKET.delete(asset.r2Key)));
      deletedAssets += assets.results.length;
      const batch = [
        env.DB.prepare(`DELETE FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(project.id, admin.id),
        env.DB.prepare(`DELETE FROM projects WHERE id = ? AND owner_id = ?`).bind(project.id, admin.id),
      ];
      if (project.renderJobId) {
        batch.push(env.DB.prepare(`DELETE FROM render_jobs WHERE id = ? AND owner_id = ?`).bind(project.renderJobId, admin.id));
      }
      await env.DB.batch(batch);
    }
    await audit(env, admin.id, "project.test-rows-cleared", "project", undefined, {
      deletedProjects: projects.results.length,
      deletedAssets,
    });
    return Response.json({ deletedProjects: projects.results.length, deletedAssets });
  } catch (error) {
    return jsonError(error);
  }
}
