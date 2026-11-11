/* Paying for a film that is longer than the 20 seconds one credit covers.
   One checkout: the part above the credit, plus the credit itself for a
   customer who has none. The webhook (billing/webhook) records the upgrade
   against the project, and submitting the project checks for it. */

import { BASE_CENTS, quoteFor, upgradeCents } from "../../pricing";

type Db = { DB: D1Database };

/** Cents of upgrade already paid for this project (ledger rows of type film_upgrade, note "upgrade:<cents>"). */
export async function paidUpgradeCents(env: Db, projectId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(CAST(SUBSTR(note, 9) AS INTEGER)), 0) AS cents FROM credit_ledger WHERE project_id = ? AND type = 'film_upgrade'`).bind(projectId).first<{ cents: number }>();
  return Number(row?.cents) || 0;
}

export type FilmQuote = { cents: number; seconds: number; scenes: number; upgrade: number; payNow: number; grantsCredit: boolean };

/** What this project needs paid before it can enter production, given the customer's credits. */
export async function filmQuote(env: Db, project: { id: string; targetDuration: number }, photos: number, hasCredit: boolean): Promise<FilmQuote> {
  const quote = quoteFor(project.targetDuration, photos);
  const upgrade = upgradeCents(quote.cents);
  const paid = await paidUpgradeCents(env, project.id);
  const payNow = Math.max(0, upgrade - paid) + (hasCredit ? 0 : BASE_CENTS);
  return { ...quote, upgrade, payNow, grantsCredit: !hasCredit };
}

/** A Stripe Checkout link for exactly payNow. Null when Stripe is not connected. */
export async function createFilmCheckout(opts: { secret: string; origin: string; ownerId: string; email: string; projectId: string; title: string; quote: FilmQuote }): Promise<string | null> {
  const { quote } = opts;
  if (quote.payNow <= 0) return null;
  const values = new URLSearchParams();
  values.set("mode", "payment");
  values.set("line_items[0][price_data][currency]", "usd");
  values.set("line_items[0][price_data][unit_amount]", String(quote.payNow));
  values.set("line_items[0][price_data][product_data][name]", `${quote.seconds}-second film`);
  values.set("line_items[0][quantity]", "1");
  values.set("success_url", `${opts.origin}/dashboard?billing=success&project=${opts.projectId}`);
  values.set("cancel_url", `${opts.origin}/dashboard?billing=cancelled`);
  values.set("customer_email", opts.email);
  values.set("client_reference_id", opts.ownerId);
  values.set("metadata[owner_id]", opts.ownerId);
  values.set("metadata[plan]", "film");
  values.set("metadata[credits]", quote.grantsCredit ? "1" : "0");
  values.set("metadata[project_id]", opts.projectId);
  values.set("metadata[upgrade_cents]", String(Math.max(0, quote.upgrade)));
  values.set("allow_promotion_codes", "true");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `film-${opts.projectId}-${quote.payNow}-${Math.floor(Date.now() / 60000)}` },
    body: values.toString(),
  });
  const data = await response.json() as { url?: string };
  return response.ok && data.url ? data.url : null;
}
