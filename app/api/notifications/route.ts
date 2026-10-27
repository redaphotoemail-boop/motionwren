import { jsonError, requireAccount } from "../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    const result = await env.DB.prepare(`SELECT id, type, title, message, read_at AS readAt, created_at AS createdAt FROM notifications WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20`).bind(account.id).all();
    return Response.json({ notifications: result.results, unread: result.results.filter((item) => !item.readAt).length });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    let id: string | null = null;
    try { const body = await request.json() as { id?: unknown }; if (typeof body.id === "string") id = body.id; } catch { /* No body: mark all read. */ }
    if (id) {
      await env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE owner_id = ? AND id = ?`).bind(Date.now(), account.id, id).run();
    } else {
      await env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE owner_id = ? AND read_at IS NULL`).bind(Date.now(), account.id).run();
    }
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
