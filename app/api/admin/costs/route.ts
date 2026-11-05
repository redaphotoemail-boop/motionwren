import { jsonError, requireAdmin } from "../../_lib/account";
import { COST_RATES, EDITED_KINDS, aggregateCosts, videoCosts, type CostAggregate } from "../../../cost-model";

/* Manager only: what videos cost to make — this month, all time, and each
   recent video line by line (video engine, music, editing, price, margin).
   "Client orders" and the owner's own Studio tests are kept apart. */

const KINDS = EDITED_KINDS.map((kind) => `'${kind}'`).join(",");
const SEGMENT = `CASE WHEN j.kind LIKE 'customer%' THEN 'customer' ELSE 'studio' END`;
const AGGREGATE = `SELECT ${SEGMENT} AS segment,
  COUNT(*) AS videos,
  COALESCE(SUM(CASE WHEN j.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS finished,
  COALESCE(SUM(CASE WHEN j.kind IN (${KINDS}) AND j.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS edited,
  COALESCE(SUM(j.cost_cents), 0) AS videoCents,
  COALESCE(SUM(CASE WHEN j.kind IN (${KINDS}) AND j.status = 'succeeded' THEN j.duration + ${COST_RATES.musicExtraSeconds} ELSE 0 END), 0) AS musicSeconds,
  COALESCE(SUM(CAST(p.price AS REAL) * 100), 0) AS priceCents
  FROM render_jobs j LEFT JOIN projects p ON p.render_job_id = j.id WHERE j.created_at >= ? GROUP BY segment`;

type Row = CostAggregate & { segment: "customer" | "studio" };

async function totals(env: { DB: D1Database }, since: number) {
  const rows = await env.DB.prepare(AGGREGATE).bind(since).all<Row>();
  const empty: CostAggregate = { videos: 0, finished: 0, edited: 0, videoCents: 0, musicSeconds: 0, priceCents: 0 };
  const pick = (segment: string) => aggregateCosts(rows.results.find((row) => row.segment === segment) || empty);
  return { customer: pick("customer"), studio: pick("studio") };
}

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const [month, allTime, recent] = await Promise.all([
      totals(env, monthStart),
      totals(env, 0),
      env.DB.prepare(`SELECT j.id, j.kind, j.status, j.category, j.duration, j.aspect, j.cost_cents AS costCents, j.created_at AS createdAt, ${SEGMENT} AS segment, CAST(p.price AS REAL) * 100 AS priceCents, u.display_name AS name, u.email AS email
        FROM render_jobs j LEFT JOIN projects p ON p.render_job_id = j.id LEFT JOIN users u ON u.id = j.owner_id
        WHERE j.kind IN (${KINDS}) ORDER BY j.created_at DESC LIMIT 60`).all<{ id: string; kind: string; status: string; category: string; duration: number; aspect: string; costCents: number; createdAt: number; segment: string; priceCents: number | null; name: string | null; email: string | null }>(),
    ]);
    return Response.json({
      month, allTime,
      recent: recent.results.map((row) => ({ id: row.id, segment: row.segment, status: row.status, title: String(row.category || "Video").replace(/^Studio · /, ""), owner: row.name || row.email || "", duration: row.duration, createdAt: row.createdAt, priceCents: row.priceCents ?? null, ...videoCosts(row) })),
      fixedMonthly: { cloudflare: COST_RATES.cloudflareWorkersPaid, elevenLabs: COST_RATES.elevenLabsStarter },
      rates: { musicPerMinute: COST_RATES.musicPerMinute, editPerFilm: COST_RATES.editPerFilm },
      paymentsConnected: Boolean(process.env.STRIPE_SECRET_KEY),
    });
  } catch (error) { return jsonError(error); }
}
