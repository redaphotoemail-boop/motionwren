import { jsonError, requireAccount } from "../../_lib/account";
import { stripeRequest, stripeSecret } from "../../_lib/stripe";

/* Pro customers manage or cancel their subscription on Stripe's own
   billing page (Stripe Dashboard → Settings → Billing → Customer portal must
   be turned on once). Returns the link; the dashboard opens it. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    if (!stripeSecret()) return Response.json({ error: "Billing is not connected yet." }, { status: 503 });
    const row = await env.DB.prepare(`SELECT stripe_customer_id AS customerId FROM users WHERE id = ? LIMIT 1`).bind(account.id).first<{ customerId: string | null }>();
    if (!row?.customerId) return Response.json({ error: "There is no subscription on this account yet." }, { status: 404 });
    const values = new URLSearchParams();
    values.set("customer", row.customerId);
    values.set("return_url", `${new URL(request.url).origin}/dashboard`);
    const result = await stripeRequest<{ url?: string }>("POST", "billing_portal/sessions", values);
    if (!result.ok || !result.data.url) return Response.json({ error: "The billing page could not be opened. Please try again." }, { status: 502 });
    return Response.json({ url: result.data.url });
  } catch (error) { return jsonError(error); }
}
