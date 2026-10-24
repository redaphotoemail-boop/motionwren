import { audit, jsonError, requireAdmin } from "../../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const now = Date.now();
    const [expiredAssets, expiredHistory, staleJobs, staleLimits] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(a.size_bytes),0) AS bytes FROM project_assets a JOIN projects p ON p.id = a.project_id WHERE a.expires_at IS NOT NULL AND a.expires_at < ? AND p.status IN ('completed','failed','cancelled')`).bind(now).first(),
      env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes FROM generation_history WHERE expires_at IS NOT NULL AND expires_at < ?`).bind(now).first(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM render_jobs WHERE status IN ('failed','succeeded') AND updated_at < ?`).bind(now - 30 * 24 * 60 * 60 * 1000).first(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM rate_limits WHERE updated_at < ?`).bind(now - 2 * 24 * 60 * 60 * 1000).first(),
    ]);
    return Response.json({ expiredAssets, expiredHistory, staleJobs, staleLimits });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const body = await request.json() as { confirmation?: unknown };
    if (body.confirmation !== "RUN RETENTION") return Response.json({ error: "Retention confirmation is required." }, { status: 400 });
    const now = Date.now();
    const [assets, history] = await Promise.all([
      env.DB.prepare(`SELECT a.id, a.r2_key AS r2Key FROM project_assets a JOIN projects p ON p.id = a.project_id WHERE a.expires_at IS NOT NULL AND a.expires_at < ? AND p.status IN ('completed','failed','cancelled') LIMIT 500`).bind(now).all<{ id: string; r2Key: string }>(),
      env.DB.prepare(`SELECT id, r2_key AS r2Key FROM generation_history WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT 500`).bind(now).all<{ id: string; r2Key: string }>(),
    ]);
    await Promise.allSettled([...assets.results, ...history.results].map((item) => env.BUCKET.delete(item.r2Key)));
    const statements = [
      ...assets.results.map((item) => env.DB.prepare(`DELETE FROM project_assets WHERE id = ?`).bind(item.id)),
      ...history.results.map((item) => env.DB.prepare(`DELETE FROM generation_history WHERE id = ?`).bind(item.id)),
      env.DB.prepare(`DELETE FROM render_jobs WHERE status IN ('failed','succeeded') AND updated_at < ?`).bind(now - 30 * 24 * 60 * 60 * 1000),
      env.DB.prepare(`DELETE FROM rate_limits WHERE updated_at < ?`).bind(now - 2 * 24 * 60 * 60 * 1000),
    ];
    if (statements.length) await env.DB.batch(statements);
    await audit(env, admin.id, "retention.completed", "system", undefined, { assets: assets.results.length, history: history.results.length });
    return Response.json({ ok: true, deletedAssets: assets.results.length, deletedHistory: history.results.length });
  } catch (error) { return jsonError(error); }
}
