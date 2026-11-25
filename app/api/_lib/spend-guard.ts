/* The spending guard, server side. Rules live in app/spend-guard.ts.

   Everything that costs money asks here first:
   - a new film / re-make / upscale asks `guardStart` with its price;
   - the scene queue asks `guardCheck` before it sends each scene;
   - `createPrediction` (the one function every engine charge goes through)
     asks `guardAtEngine`, so nothing can reach the video engine while the
     guard says stop, even a code path that forgot to ask.
   Settings live in platform_settings, so no database change is needed. */

import { COST_RATES, EDITED_KINDS } from "../../cost-model";
import { GUARD_ALERT_STEPS, GUARD_DEFAULTS, cleanSettings, decideSpend, guardDollars, guardLevel, periodStarts, type GuardLevel, type GuardSettings } from "../../spend-guard";

type GuardEnv = { DB: D1Database };

const SETTINGS_KEY = "spend_guard";

export async function readGuardSettings(env: GuardEnv): Promise<GuardSettings> {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(SETTINGS_KEY).first<{ value?: string }>().catch(() => null);
  try { return cleanSettings(row?.value ? JSON.parse(row.value) : GUARD_DEFAULTS); } catch { return { ...GUARD_DEFAULTS }; }
}

export async function writeGuardSettings(env: GuardEnv, change: Partial<GuardSettings>) {
  const next = cleanSettings({ ...(await readGuardSettings(env)), ...change });
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(SETTINGS_KEY, JSON.stringify(next), Date.now()).run();
  return next;
}

const KINDS = EDITED_KINDS.map((kind) => `'${kind}'`).join(",");

/* What was spent since a moment: the engine price each film recorded (re-makes and upscales are added to it),
   the AI quality check, and the editing estimate. Music is counted by the Spend page, not here: the music library is free. */
export async function spentSince(env: GuardEnv, since: number) {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(j.cost_cents), 0) AS engine, COALESCE(SUM(CAST(rc.value AS REAL)), 0) AS review,
      COALESCE(SUM(CASE WHEN j.kind IN (${KINDS}) AND j.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS edited
    FROM render_jobs j LEFT JOIN platform_settings rc ON rc.key = 'review-cost:' || j.id WHERE j.created_at >= ?`).bind(since).first<{ engine: number; review: number; edited: number }>().catch(() => null);
  const engine = Math.round(Number(row?.engine || 0));
  const review = Math.round(Number(row?.review || 0));
  const edit = Math.round(Number(row?.edited || 0) * COST_RATES.editPerFilm * 100);
  return { engineCents: engine, reviewCents: review, editCents: edit, totalCents: engine + review + edit };
}

/* The same spend as spentSince, opened up: by kind of cost, by who it was for, and film by film, so every figure on the
   Today and This month bars can be traced. The totals use exactly the same sums as spentSince, so they always agree. */
export async function spendBreakdown(env: GuardEnv, since: number) {
  const rows = await env.DB.prepare(`SELECT j.id AS id, j.kind AS kind, j.status AS status, j.category AS title, j.duration AS duration, j.created_at AS createdAt,
      COALESCE(j.cost_cents, 0) AS engine, COALESCE(CAST(rc.value AS REAL), 0) AS review,
      CASE WHEN j.kind IN (${KINDS}) AND j.status = 'succeeded' THEN 1 ELSE 0 END AS edited
    FROM render_jobs j LEFT JOIN platform_settings rc ON rc.key = 'review-cost:' || j.id WHERE j.created_at >= ? ORDER BY j.created_at DESC`).bind(since).all<{ id: string; kind: string; status: string; title: string; duration: number; createdAt: number; engine: number; review: number; edited: number }>().catch(() => ({ results: [] as { id: string; kind: string; status: string; title: string; duration: number; createdAt: number; engine: number; review: number; edited: number }[] }));
  const editCents = Math.round(COST_RATES.editPerFilm * 100);
  const films = rows.results.map((row) => {
    const engine = Number(row.engine) || 0, review = Number(row.review) || 0, edit = row.edited ? editCents : 0;
    return { id: row.id, title: String(row.title || "Video").replace(/^Studio · /, ""), segment: String(row.kind).startsWith("customer") ? "customer" : "studio", status: row.status, duration: row.duration, createdAt: row.createdAt, engineCents: engine, reviewCents: review, editCents: edit, totalCents: engine + review + edit };
  });
  const total = (pick: (film: (typeof films)[number]) => number, only?: string) => Math.round(films.filter((film) => !only || film.segment === only).reduce((sum, film) => sum + pick(film), 0));
  const customer = films.filter((film) => film.segment === "customer"), studio = films.filter((film) => film.segment === "studio");
  const sum = (list: typeof films) => Math.round(list.reduce((acc, film) => acc + film.totalCents, 0));
  return {
    films: films.length,
    categories: { engineCents: total((film) => film.engineCents), reviewCents: total((film) => film.reviewCents), editCents: total((film) => film.editCents) },
    segments: { customer: { films: customer.length, cents: sum(customer) }, studio: { films: studio.length, cents: sum(studio) } },
    top: [...films].sort((a, b) => b.totalCents - a.totalCents).slice(0, 40),
  };
}

export async function guardStatus(env: GuardEnv) {
  const settings = await readGuardSettings(env);
  const { dayStart, monthStart, dayKey, monthKey } = periodStarts();
  const [month, day] = await Promise.all([spentSince(env, monthStart), spentSince(env, dayStart)]);
  return { settings, month, day, dayKey, monthKey, decision: decideSpend({ settings, monthCents: month.totalCents, dayCents: day.totalCents }) };
}

/* One alert per limit, per period, per step (50%, 80%, 100%), kept in the notifications table by its id. */
async function sendAlerts(env: GuardEnv, status: Awaited<ReturnType<typeof guardStatus>>) {
  const { settings } = status;
  const checks: { label: string; periodKey: string; spent: number; limit: number; level: GuardLevel }[] = [
    { label: "today's", periodKey: status.dayKey, spent: status.day.totalCents, limit: settings.dailyCents, level: guardLevel(status.day.totalCents, settings.dailyCents) },
    { label: "this month's", periodKey: status.monthKey, spent: status.month.totalCents, limit: settings.monthlyCents, level: guardLevel(status.month.totalCents, settings.monthlyCents) },
  ];
  const due = checks.flatMap((check) => GUARD_ALERT_STEPS.filter((step) => check.level >= step).map((step) => ({ ...check, step })));
  if (!due.length) return;
  const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin'`).all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));
  for (const item of due) {
    const stopped = item.step === 100;
    const title = stopped ? `Spending stopped · ${item.label.replace("'s", "")} limit reached` : `Spending at ${item.step}% of ${item.label} limit`;
    const message = stopped
      ? `You have spent ${guardDollars(item.spent)} of ${guardDollars(item.limit)}. Everything that costs money is stopped (new films, unsent scenes, re-makes, upscales and quality checks). Scenes already with the video engine finish. Raise the limit on the Spend page to continue.`
      : `You have spent ${guardDollars(item.spent)} of ${guardDollars(item.limit)}. At 100% everything that costs money stops by itself.`;
    for (const admin of admins.results) {
      await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, owner_id, type, title, message, read_at, created_at) VALUES (?, ?, 'provider_alert', ?, ?, NULL, ?)`).bind(`spend:${item.label}:${item.periodKey}:${item.step}:${admin.id}`, admin.id, title, message, Date.now()).run().catch(() => undefined);
    }
  }
}

export type GuardAnswer = { ok: true; needsConfirm: boolean } | { ok: false; why: "paused" | "daily" | "monthly"; message: string };

/* May something costing `estimateCents` (0 = already paid for) go ahead? Also sends the 50/80/100% alerts. */
export async function guardCheck(env: GuardEnv, estimateCents = 0): Promise<GuardAnswer> {
  let status: Awaited<ReturnType<typeof guardStatus>>;
  try { status = await guardStatus(env); } catch { return { ok: true, needsConfirm: false }; } // the guard never takes the site down
  await sendAlerts(env, status).catch(() => undefined);
  const decision = decideSpend({ settings: status.settings, monthCents: status.month.totalCents, dayCents: status.day.totalCents, estimateCents });
  return decision.allow ? { ok: true, needsConfirm: decision.needsConfirm } : { ok: false, why: decision.why, message: decision.message };
}

/* A new paid job (film, re-make, upscale). Returns a ready JSON error response when it must not start:
   402 when a limit or the pause stops it, 409 `needsConfirm` when it costs more than the per-film amount and was not confirmed. */
export async function guardStart(env: GuardEnv, estimateCents: number, options: { confirmed?: boolean; askAbove?: boolean } = {}): Promise<Response | null> {
  const answer = await guardCheck(env, estimateCents);
  if (!answer.ok) return Response.json({ error: answer.message, spendStopped: answer.why }, { status: 402 });
  if (answer.needsConfirm && options.askAbove && !options.confirmed) {
    return Response.json({ error: `This costs about ${guardDollars(estimateCents)}. Confirm to go ahead.`, needsConfirm: true, costCents: Math.round(estimateCents) }, { status: 409 });
  }
  return null;
}

/* The last gate: every engine charge goes through createPrediction, which calls this. It never asks for a yes and never
   counts the new charge (the film's price was counted when it started); it only refuses while the guard says stop. */
export async function guardAtEngine(): Promise<string | null> {
  let env: GuardEnv;
  try { ({ env } = (await import("cloudflare:workers")) as unknown as { env: GuardEnv }); } catch { return null; } // not on Cloudflare (local tests)
  if (!env?.DB) return null;
  const answer = await guardCheck(env, 0);
  return answer.ok ? null : answer.message;
}
