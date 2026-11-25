import { submitOrder } from "../../_lib/submit-order";
import { MEMBER_FILM_UPGRADE_CENTS } from "../../../pricing";

function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

/* Stripe's signature header can carry several v1 signatures (during a
   secret rotation); any one matching is enough. */
async function verify(payload: string, header: string, secret: string) {
  const pairs = header.split(",").map((part) => part.split("=", 2) as [string, string]);
  const timestamp = Number(pairs.find(([key]) => key === "t")?.[1]);
  const signatures = pairs.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => safeEqual(expected, signature));
}

type Meta = Record<string, string>;
type StripeObject = { id?: string; mode?: string; customer?: string; subscription?: string; payment_intent?: string; payment_status?: string; amount_total?: number; amount_paid?: number; currency?: string; status?: string; current_period_end?: number; cancel_at_period_end?: boolean; metadata?: Meta; subscription_details?: { metadata?: Meta }; parent?: { subscription_details?: { subscription?: string; metadata?: Meta } }; lines?: { data?: { metadata?: Meta }[] } };

const filled = (meta?: Meta | null) => meta && Object.keys(meta).length ? meta : null;

/* Stripe sends metadata: {} on invoices, so the subscription's metadata has
   to be looked for in every place Stripe puts it (by API version). */
function metadataOf(object: StripeObject): Meta {
  return filled(object.metadata) || filled(object.parent?.subscription_details?.metadata) || filled(object.subscription_details?.metadata) || filled(object.lines?.data?.[0]?.metadata) || {};
}

/* The films a payment covers: a package carries "projectId:upgradeCents,…";
   a single film carries project_id and upgrade_cents. */
function paidFilms(meta: Meta): { projectId: string; upgrade: number }[] {
  if (meta.films) return meta.films.split(",").map((pair) => pair.split(":")).filter(([id]) => /^[0-9a-f-]{36}$/i.test(id || "")).map(([id, cents]) => ({ projectId: id, upgrade: Math.max(0, Math.min(1_000_000, Number(cents) || 0)) }));
  if (meta.project_id) return [{ projectId: String(meta.project_id), upgrade: Math.max(0, Math.min(1_000_000, Number(meta.upgrade_cents) || 0)) }];
  return [];
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Billing webhook is not configured." }, { status: 503 });
  const payload = await request.text();
  if (!await verify(payload, request.headers.get("stripe-signature") || "", secret)) return Response.json({ error: "Invalid billing signature." }, { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: StripeObject } };
  const object = event.data.object;
  const { env } = await import("cloudflare:workers");
  const metadata = metadataOf(object);
  const ownerId = metadata.owner_id;
  if (!ownerId) return Response.json({ received: true });
  const now = Date.now();
  // Only money that has actually arrived grants anything (a delayed method such as a bank debit completes later, as async_payment_succeeded).
  const paidSession = (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && object.mode === "payment" && (object.payment_status === "paid" || object.payment_status === "no_payment_required");
  if (paidSession || event.type === "invoice.paid") {
    const credits = Math.max(0, Math.min(1000, Number(metadata.credits) || 0));
    const films = paidFilms(metadata);
    // Credits, upgrades and the payment record land together, once per Stripe event.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, NULL, NULL, ?, 'purchase', ?, ?, ?)`).bind(crypto.randomUUID(), ownerId, credits, `stripe:${event.id}`, `Stripe ${metadata.plan || "credit"} purchase`, now),
      env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + ?, plan = CASE WHEN ? = 'pro' THEN 'pro' ELSE plan END, stripe_customer_id = COALESCE(?, stripe_customer_id), updated_at = ? WHERE id = ? AND changes() = 1`).bind(credits, metadata.plan || "", object.customer || null, now, ownerId),
      // A longer film: what was paid above the credit is remembered against the project, so submitting it can check.
      ...films.filter((film) => film.upgrade > 0).map((film) => env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, ?, NULL, 0, 'film_upgrade', ?, ?, ?)`).bind(crypto.randomUUID(), ownerId, film.projectId, `film-upgrade:${event.id}:${film.projectId}`, `upgrade:${film.upgrade}`, now)),
      // Membership: each paid month also leaves one "membership film" per credit, which covers a film up to MEMBER_FILM_SECONDS
      // (keyed by event, so a repeated event adds nothing; claimed by submitOrder, given back by a refund).
      ...(metadata.plan === "pro" && event.type === "invoice.paid" ? Array.from({ length: credits }, (_, index) => env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) VALUES (?, ?, NULL, NULL, 0, 'member_film', ?, ?, ?)`).bind(crypto.randomUUID(), ownerId, `member-film:${event.id}:${index}`, `upgrade:${MEMBER_FILM_UPGRADE_CENTS}`, now)) : []),
      env.DB.prepare(`INSERT OR IGNORE INTO payments (id, owner_id, provider_payment_id, plan, amount_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'paid', ?)`).bind(event.id, ownerId, object.payment_intent || object.id || null, metadata.plan || "credits", Math.max(0, Number(object.amount_total ?? object.amount_paid) || 0), object.currency || "usd", now),
    ]);
    // A paid film is submitted here (fast), and the once-a-minute heartbeat starts it
    // (startPaidOrders): the customer never has to come back and press anything.
    if (films.length) {
      const user = await env.DB.prepare(`SELECT role FROM users WHERE id = ? LIMIT 1`).bind(ownerId).first<{ role: string }>();
      for (const film of films) {
        try {
          await submitOrder(env, { id: ownerId, role: user?.role || "customer" }, film.projectId);
        } catch (error) {
          console.error("[billing] paid film could not be submitted", film.projectId, error instanceof Error ? error.message : error);
        }
      }
    }
  }
  if (event.type.startsWith("customer.subscription.")) {
    const subscriptionId = object.id || object.subscription;
    if (subscriptionId) await env.DB.prepare(`INSERT INTO subscriptions (id, owner_id, provider_subscription_id, plan, status, current_period_end, cancel_at_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider_subscription_id) DO UPDATE SET status = excluded.status, current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at`).bind(crypto.randomUUID(), ownerId, subscriptionId, metadata.plan || "pro", object.status || "active", object.current_period_end ? object.current_period_end * 1000 : null, object.cancel_at_period_end ? 1 : 0, now, now).run();
    // Membership (plan 'pro') ended: the account goes back to pay-per-film (credits and membership films already given stay).
    if (event.type === "customer.subscription.deleted" || object.status === "canceled") await env.DB.prepare(`UPDATE users SET plan = 'free', updated_at = ? WHERE id = ? AND plan = 'pro'`).bind(now, ownerId).run();
  }
  return Response.json({ received: true });
}
