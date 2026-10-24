import { audit, jsonError, requireAccount } from "../../_lib/account";

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    if (account.role === "admin") return Response.json({ error: "The owner account cannot be deleted from the customer interface." }, { status: 409 });
    const body = await request.json() as { confirmation?: unknown };
    if (body.confirmation !== "DELETE MY ACCOUNT") return Response.json({ error: "Type DELETE MY ACCOUNT to confirm." }, { status: 400 });
    const [assets, history] = await Promise.all([
      env.DB.prepare(`SELECT r2_key AS r2Key FROM project_assets WHERE owner_id = ?`).bind(account.id).all<{ r2Key: string }>(),
      env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE owner_id = ?`).bind(account.id).all<{ r2Key: string }>(),
    ]);
    await Promise.allSettled([...assets.results, ...history.results].map((item) => env.BUCKET.delete(item.r2Key)));
    await audit(env, account.id, "account.deletion_requested", "account", account.id);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM project_assets WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM generation_history WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM render_jobs WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM projects WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM credit_ledger WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM subscriptions WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM payments WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM notifications WHERE owner_id = ?`).bind(account.id),
      env.DB.prepare(`DELETE FROM rate_limits WHERE key LIKE ?`).bind(`${account.id}:%`),
      env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(account.id),
    ]);
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
