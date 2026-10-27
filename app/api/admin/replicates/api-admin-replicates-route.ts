import { jsonError, requireAdmin } from "../../_lib/account";

const LOW_BALANCE_KEY = "replicate_low_balance_cents";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const [jobs, history, setting] = await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(cost_cents), 0) AS cents, COUNT(*) AS count FROM render_jobs").first<{ cents: number; count: number }>(),
      env.DB.prepare("SELECT COALESCE(SUM(cost_cents), 0) AS cents, COUNT(*) AS count FROM generation_history").first<{ cents: number; count: number }>(),
      env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind(LOW_BALANCE_KEY).first<{ value?: string }>(),
    ]);
    const jobsCents = Number(jobs?.cents || 0);
    const historyCents = Number(history?.cents || 0);
    return Response.json({
      spend: { totalCents: jobsCents + historyCents, renderJobsCents: jobsCents, historyCents, renderJobCount: Number(jobs?.count || 0), historyCount: Number(history?.count || 0) },
      token: { configured: Boolean(env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_TOKEN) },
      balance: { available: false, message: "Replicate does not expose an account-balance API. Check the official billing page." },
      billingUrl: "https://replicate.com/account/billing",
      lowBalanceAlertCents: setting?.value ? Number(setting.value) : null,
    });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json() as { lowBalanceAlertCents?: unknown };
    if (body.lowBalanceAlertCents === null || body.lowBalanceAlertCents === "") {
      await env.DB.prepare("DELETE FROM platform_settings WHERE key = ?1").bind(LOW_BALANCE_KEY).run();
      return Response.json({ lowBalanceAlertCents: null });
    }
    const value = Number(body.lowBalanceAlertCents);
    if (!Number.isInteger(value) || value < 0 || value > 100000000) return Response.json({ error: "Enter a whole-number alert threshold in cents." }, { status: 400 });
    await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(LOW_BALANCE_KEY, String(value), Date.now()).run();
    return Response.json({ lowBalanceAlertCents: value });
  } catch (error) { return jsonError(error); }
}
