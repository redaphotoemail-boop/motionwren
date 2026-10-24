function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

async function verify(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return safeEqual(signature, parts.v1);
}

type StripeObject = { id?: string; mode?: string; customer?: string; subscription?: string; payment_intent?: string; amount_total?: number; amount_paid?: number; currency?: string; status?: string; current_period_end?: number; cancel_at_period_end?: boolean; metadata?: Record<string, string>; parent?: { subscription_details?: { subscription?: string; metadata?: Record<string, string> } } };

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Billing webhook is not configured." }, { status: 503 });
  const payload = await request.text();
  if (!await verify(payload, request.headers.get("stripe-signature") || "", secret)) return Response.json({ error: "Invalid billing signature." }, { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: StripeObject } };
  const object = event.data.object;
  const { env } = await import("cloudflare:workers");
  const metadata = object.metadata || object.parent?.subscription_details?.metadata || {};
  const ownerId = metadata.owner_id;
  if (!ownerId) return Response.json({ received: true });
  const now = Date.now();
  if ((event.type === "checkout.session.completed" && object.mode === "payment") || event.type === "invoice.paid") {
    const credits = Math.max(0, Math.min(1000, Number(metadata.credits) || 0));
    if (credits) {
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, NULL, NULL, ?, 'purchase', ?, ?, ?)`).bind(crypto.randomUUID(), ownerId, credits, `stripe:${event.id}`, `Stripe ${metadata.plan || "credit"} purchase`, now).run();
      if (inserted.meta.changes) await env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + ?, plan = CASE WHEN ? = 'pro' THEN 'pro' ELSE plan END, stripe_customer_id = COALESCE(?, stripe_customer_id), updated_at = ? WHERE id = ?`).bind(credits, metadata.plan || "", object.customer || null, now, ownerId).run();
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO payments (id, owner_id, provider_payment_id, plan, amount_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'paid', ?)`).bind(event.id, ownerId, object.payment_intent || object.id || null, metadata.plan || "credits", Math.max(0, Number(object.amount_total ?? object.amount_paid) || 0), object.currency || "usd", now).run();
  }
  if (event.type.startsWith("customer.subscription.")) {
    const subscriptionId = object.id || object.subscription;
    if (subscriptionId) await env.DB.prepare(`INSERT INTO subscriptions (id, owner_id, provider_subscription_id, plan, status, current_period_end, cancel_at_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider_subscription_id) DO UPDATE SET status = excluded.status, current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at`).bind(crypto.randomUUID(), ownerId, subscriptionId, metadata.plan || "pro", object.status || "active", object.current_period_end ? object.current_period_end * 1000 : null, object.cancel_at_period_end ? 1 : 0, now, now).run();
  }
  return Response.json({ received: true });
}
