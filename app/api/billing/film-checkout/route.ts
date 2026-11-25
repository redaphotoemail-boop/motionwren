import { enforceRateLimit, jsonError, requireAccount } from "../../_lib/account";
import { createPackageCheckout, filmQuote, type FilmQuote } from "../../_lib/film-checkout";

/* One checkout for every film of an order that still needs paying. Credits
   the customer already has are used first, oldest film first; each film
   without a credit pays the base price plus anything above 20 seconds. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    await enforceRateLimit(env, account.id, "film-checkout", 20, 60 * 60 * 1000);
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return Response.json({ error: "Billing is not connected yet." }, { status: 503 });
    const body = await request.json() as { projectIds?: unknown };
    const ids = Array.isArray(body.projectIds) ? [...new Set(body.projectIds.map(String))].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 8) : [];
    if (!ids.length) return Response.json({ error: "Choose the films to pay for." }, { status: 400 });
    const balanceRow = await env.DB.prepare(`SELECT credit_balance AS balance FROM users WHERE id = ?`).bind(account.id).first<{ balance: number }>();
    let credits = balanceRow?.balance || 0;
    const films: { projectId: string; quote: FilmQuote }[] = [];
    for (const id of ids) {
      const project = await env.DB.prepare(`SELECT id, status, target_duration AS targetDuration FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, account.id).first<{ id: string; status: string; targetDuration: number }>();
      if (!project || project.status !== "draft") continue;
      const photos = await env.DB.prepare(`SELECT COUNT(*) AS count FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(id, account.id).first<{ count: number }>();
      if ((photos?.count || 0) < 2) continue;
      const hasCredit = credits > 0;
      if (hasCredit) credits -= 1;
      films.push({ projectId: id, quote: await filmQuote(env, { id, targetDuration: Number(project.targetDuration) || 0 }, photos?.count || 0, hasCredit) });
    }
    const due = films.reduce((sum, film) => sum + film.quote.payNow, 0);
    if (!due) return Response.json({ url: null, due: 0 });
    const url = await createPackageCheckout({ secret, origin: new URL(request.url).origin, ownerId: account.id, email: account.email, films });
    if (!url) return Response.json({ error: "We couldn't open checkout just now. Your order is saved; please try again in a moment." }, { status: 502 });
    return Response.json({ url, due });
  } catch (error) { return jsonError(error); }
}
