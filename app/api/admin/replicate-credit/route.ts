import { jsonError, requireAdmin } from "../../_lib/account";
import { spentSince } from "../../_lib/spend-guard";

/* Manager only. Replicate has no balance endpoint, so the balance shown is an estimate: the amount the owner
   last said they added (with the moment they said it), minus what our films recorded since. */
const KEY = "replicate_credit";

async function view(env: { DB: D1Database }) {
  const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind(KEY).first<{ value?: string }>().catch(() => null);
  let saved: { cents: number; at: number } | null = null;
  try { const parsed = row?.value ? JSON.parse(row.value) : null; if (parsed && Number.isFinite(parsed.cents) && Number.isFinite(parsed.at)) saved = { cents: parsed.cents, at: parsed.at }; } catch { saved = null; }
  if (!saved) return { saved: null, spentCents: 0, estimateCents: null };
  const spent = await spentSince(env, saved.at);
  return { saved, spentCents: spent.engineCents, estimateCents: Math.round(saved.cents - spent.engineCents) };
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
    const body = await request.json() as { balanceCents?: unknown };
    const value = Number(body.balanceCents);
    if (!Number.isInteger(value) || value < 0 || value > 100000000) return Response.json({ error: "Enter the balance in dollars, for example 25." }, { status: 400 });
    await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(KEY, JSON.stringify({ cents: value, at: Date.now() }), Date.now()).run();
    return Response.json(await view(env));
  } catch (error) { return jsonError(error); }
}
