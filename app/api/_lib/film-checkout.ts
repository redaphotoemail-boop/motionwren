/* Paying for a film that is longer than the 20 seconds one credit covers.
   One checkout: the part above the credit, plus the credit itself for a
   customer who has none. The webhook (billing/webhook) records the upgrade
   against the project, and submitting the project checks for it.

   Membership films: each month of membership leaves "member_film" ledger
   rows (project_id empty, note "upgrade:<cents>"). A member's film that
   uses a credit takes one of them, which pays the part above the credit up
   to the long film (LONG_SECONDS). Submitting the order claims it. */

import { BASE_CENTS, quoteFor, upgradeCents } from "../../pricing";

type Db = { DB: D1Database };

/** Cents of upgrade already covered for this project: paid upgrades (film_upgrade) and a claimed membership film (member_film), note "upgrade:<cents>". */
export async function paidUpgradeCents(env: Db, projectId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(CAST(SUBSTR(note, 9) AS INTEGER)), 0) AS cents FROM credit_ledger WHERE project_id = ? AND type IN ('film_upgrade', 'member_film')`).bind(projectId).first<{ cents: number }>();
  return Number(row?.cents) || 0;
}

/** Membership films the customer still has: rows not yet given to a film, with what each one covers. */
export async function memberFilmsLeft(env: Db, ownerId: string): Promise<{ count: number; cents: number }> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(MIN(CAST(SUBSTR(note, 9) AS INTEGER)), 0) AS cents FROM credit_ledger WHERE owner_id = ? AND type = 'member_film' AND project_id IS NULL`).bind(ownerId).first<{ count: number; cents: number }>();
  return { count: Number(row?.count) || 0, cents: Number(row?.cents) || 0 };
}

/** Claims one membership film for this project (only once per project, and only after its credit is reserved). */
export const claimMemberFilm = (env: Db, ownerId: string, projectId: string) => env.DB.prepare(`UPDATE credit_ledger SET project_id = ? WHERE id = (SELECT id FROM credit_ledger WHERE owner_id = ? AND type = 'member_film' AND project_id IS NULL ORDER BY created_at LIMIT 1) AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE project_id = ? AND type = 'member_film') AND EXISTS (SELECT 1 FROM credit_ledger WHERE project_id = ? AND type = 'project_reservation')`).bind(projectId, ownerId, projectId, projectId);

/** A refunded order gives its membership film back. */
export const releaseMemberFilm = (env: Db, ownerId: string, projectId: string) => env.DB.prepare(`UPDATE credit_ledger SET project_id = NULL WHERE owner_id = ? AND project_id = ? AND type = 'member_film'`).bind(ownerId, projectId);

export type FilmQuote = { cents: number; seconds: number; scenes: number; upgrade: number; payNow: number; grantsCredit: boolean; usesMemberFilm: boolean; memberCover: number };

/** What this project needs paid before it can enter production, given the customer's credits
    and the membership films they have left (memberFilmCents: what one covers, 0 for none). */
export async function filmQuote(env: Db, project: { id: string; targetDuration: number }, photos: number, hasCredit: boolean, memberFilmCents = 0): Promise<FilmQuote> {
  const quote = quoteFor(project.targetDuration, photos);
  const upgrade = upgradeCents(quote.cents);
  const paid = await paidUpgradeCents(env, project.id);
  const owed = Math.max(0, upgrade - paid);
  const usesMemberFilm = hasCredit && owed > 0 && memberFilmCents > 0;
  const covered = usesMemberFilm ? Math.min(owed, memberFilmCents) : 0;
  const payNow = owed - covered + (hasCredit ? 0 : BASE_CENTS);
  return { ...quote, upgrade, payNow, grantsCredit: !hasCredit, usesMemberFilm, memberCover: covered };
}

/** The upgrade a card payment pays for: the part above the credit, less what a membership film covers
    (that part is claimed from the membership film when the order is submitted). */
const cardUpgrade = (quote: FilmQuote) => Math.max(0, quote.upgrade - quote.memberCover);

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
  values.set("metadata[upgrade_cents]", String(cardUpgrade(quote)));
  values.set("allow_promotion_codes", "true");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `film-${opts.projectId}-${quote.payNow}-${Math.floor(Date.now() / 60000)}` },
    body: values.toString(),
  });
  const data = await response.json() as { url?: string };
  return response.ok && data.url ? data.url : null;
}

/** One Stripe Checkout for several films of one order (a package), so the
    customer pays once instead of once per film. Metadata carries every
    project and its upgrade, and the number of credits bought; the webhook
    records them and starts each film. Null when nothing is due or Stripe
    is not connected. */
export async function createPackageCheckout(opts: { secret: string; origin: string; ownerId: string; email: string; films: { projectId: string; quote: FilmQuote }[] }): Promise<string | null> {
  const session = await createPackageSession(opts, false);
  return session?.url || null;
}

/* The same checkout shown on MotionWren's own page (Rm, Nov 26 2026: "the same coherent page ... the same
   style and the same design"): Stripe's Payment Element, styled like the site, inside our own payment sheet.
   Same line items, metadata and webhook; only the way it is shown changes. Returns the client secret
   the page mounts the form with, or null when nothing is due or Stripe refused. */
export async function createEmbeddedPackageCheckout(opts: { secret: string; origin: string; ownerId: string; email: string; films: { projectId: string; quote: FilmQuote }[] }): Promise<string | null> {
  const session = await createPackageSession(opts, true);
  return session?.clientSecret || null;
}

async function createPackageSession(opts: { secret: string; origin: string; ownerId: string; email: string; films: { projectId: string; quote: FilmQuote }[] }, embedded: boolean): Promise<{ url: string | null; clientSecret: string | null } | null> {
  const films = opts.films.filter((film) => film.quote.payNow > 0).slice(0, 8);
  if (!films.length) return null;
  const values = new URLSearchParams();
  values.set("mode", "payment");
  films.forEach((film, index) => {
    values.set(`line_items[${index}][price_data][currency]`, "usd");
    values.set(`line_items[${index}][price_data][unit_amount]`, String(film.quote.payNow));
    values.set(`line_items[${index}][price_data][product_data][name]`, `${film.quote.seconds}-second film`);
    values.set(`line_items[${index}][quantity]`, "1");
  });
  if (embedded) {
    // Payment Element on our page: Stripe sends the customer back here only when a payment method needs a redirect (a bank page, Klarna).
    values.set("ui_mode", "elements");
    values.set("return_url", `${opts.origin}/dashboard?billing=success`);
  } else {
    values.set("success_url", `${opts.origin}/dashboard?billing=success`);
    values.set("cancel_url", `${opts.origin}/dashboard?billing=cancelled`);
  }
  values.set("customer_email", opts.email);
  values.set("client_reference_id", opts.ownerId);
  values.set("metadata[owner_id]", opts.ownerId);
  values.set("metadata[plan]", "film");
  values.set("metadata[credits]", String(films.filter((film) => film.quote.grantsCredit).length));
  // "projectId:upgradeCents" per film, comma-separated (8 films fit Stripe's 500-character limit).
  values.set("metadata[films]", films.map((film) => `${film.projectId}:${cardUpgrade(film.quote)}`).join(","));
  values.set("allow_promotion_codes", "true");
  const key = `package-${embedded ? "e-" : ""}${films.map((film) => film.projectId).sort().join("-").slice(0, 120)}-${Math.floor(Date.now() / 60000)}`;
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key },
    body: values.toString(),
  });
  const data = await response.json() as { url?: string | null; client_secret?: string | null };
  if (!response.ok) return null;
  return { url: data.url || null, clientSecret: data.client_secret || null };
}
