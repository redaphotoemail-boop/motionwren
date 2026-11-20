import { jsonError, requireAdmin } from "../../_lib/account";
import { guardStatus, writeGuardSettings } from "../../_lib/spend-guard";
import { guardLevel } from "../../../spend-guard";

/* Manager only: the spending guard's limits, what has been spent today and this month (engine, quality check,
   editing), and whether everything is running, close to a limit, or stopped. */

async function view(env: { DB: D1Database }) {
  const status = await guardStatus(env);
  const { settings, month, day, decision } = status;
  return {
    settings,
    month: { ...month, level: guardLevel(month.totalCents, settings.monthlyCents) },
    day: { ...day, level: guardLevel(day.totalCents, settings.dailyCents) },
    running: decision.allow,
    stopped: decision.allow ? null : { why: decision.why, message: decision.message },
  };
}

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    return Response.json(await view(env));
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json() as Record<string, unknown>;
    const change: Record<string, unknown> = {};
    // Dollars in, whole cents stored. A blank or 0 means "no limit".
    for (const [field, key] of [["monthly", "monthlyCents"], ["daily", "dailyCents"], ["perFilm", "perFilmCents"]] as const) {
      if (body[field] === undefined) continue;
      const dollars = Number(body[field] === "" ? 0 : body[field]);
      if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) return Response.json({ error: "Enter an amount in dollars, or 0 for no limit." }, { status: 400 });
      change[key] = Math.round(dollars * 100);
    }
    if (body.paused !== undefined) change.paused = body.paused === true;
    await writeGuardSettings(env, change);
    return Response.json(await view(env));
  } catch (error) { return jsonError(error); }
}
