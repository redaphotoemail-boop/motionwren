import { audit, jsonError, requireAccount } from "../../_lib/account";

const PLANS = {
  single: { priceEnv: "STRIPE_PRICE_SINGLE", mode: "payment", credits: 1, label: "Single" },
  five: { priceEnv: "STRIPE_PRICE_FIVE_PACK", mode: "payment", credits: 5, label: "Five-pack" },
  pro: { priceEnv: "STRIPE_PRICE_PRO", mode: "subscription", credits: 10, label: "Pro" },
} as const;

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    const secret = process.env.STRIPE_SECRET_KEY;
    const body = await request.json() as { plan?: unknown };
    const planKey = typeof body.plan === "string" && body.plan in PLANS ? body.plan as keyof typeof PLANS : null;
    if (!planKey) return Response.json({ error: "Choose a valid credit package." }, { status: 400 });
    const plan = PLANS[planKey];
    const price = process.env[plan.priceEnv];
    if (!secret || !price) return Response.json({ error: "Billing is not connected yet." }, { status: 503 });
    const origin = new URL(request.url).origin;
    const values = new URLSearchParams();
    values.set("mode", plan.mode);
    values.set("line_items[0][price]", price);
    values.set("line_items[0][quantity]", "1");
    values.set("success_url", `${origin}/dashboard?billing=success`);
    values.set("cancel_url", `${origin}/dashboard?billing=cancelled`);
    values.set("customer_email", account.email);
    values.set("client_reference_id", account.id);
    values.set("metadata[owner_id]", account.id);
    values.set("metadata[plan]", planKey);
    values.set("metadata[credits]", String(plan.credits));
    values.set("allow_promotion_codes", "true");
    if (plan.mode === "subscription") {
      values.set("subscription_data[metadata][owner_id]", account.id);
      values.set("subscription_data[metadata][plan]", planKey);
      values.set("subscription_data[metadata][credits]", String(plan.credits));
    }
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `checkout-${account.id}-${planKey}-${Math.floor(Date.now() / 60000)}` },
      body: values.toString(),
    });
    const data = await response.json() as { id?: string; url?: string; error?: { message?: string } };
    if (!response.ok || !data.url) return Response.json({ error: data.error?.message || "Checkout could not be started." }, { status: 502 });
    await audit(env, account.id, "billing.checkout_created", "billing", data.id, { plan: planKey });
    return Response.json({ url: data.url });
  } catch (error) { return jsonError(error); }
}
