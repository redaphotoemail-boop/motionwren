/* Reads what Cloudflare is billing us this period (Finance, Cloudflare section). Read-only: nothing here changes
   anything at Cloudflare. Uses the owner's read-only token (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).

   1. Cloudflare's billable usage (GET /accounts/{id}/billable-usage, the figures its invoice uses), when the token
      also has Billing Read. Otherwise our own pricing of its usage analytics, marked as an estimate.
   2. The editing machines' time by feature (each machine carries a feature label), to split their cost.
   The math lives in app/cloudflare-bill.ts. */

import { PLAN_CENTS, byFeature, machineDollars, periodAround, projection, type ProductLine } from "../../cloudflare-bill";
import { cloudflareConnected, query, readCloudflareUsage } from "./cloudflare-usage";
import { priceAll, type CategoryKey } from "../../cloudflare-cost";

type Env = { DB: D1Database } & Record<string, unknown>;
const secret = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;
const DAY = 24 * 60 * 60 * 1000;

type Item = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const time = (value: unknown) => { const t = Date.parse(text(value)); return Number.isFinite(t) ? t : 0; };

async function cloudflareGet(path: string) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${secret("CLOUDFLARE_ACCOUNT_ID")}${path}`, {
    headers: { Authorization: `Bearer ${secret("CLOUDFLARE_API_TOKEN")}` }, signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as { success?: boolean; result?: unknown; errors?: { message?: string }[] } | null;
  if (!response.ok || data?.success === false) throw new Error(String(data?.errors?.[0]?.message || `Cloudflare answered HTTP ${response.status}.`).slice(0, 160));
  return data?.result;
}

/* Cloudflare's own billed usage for the current period, by product (cents). */
export async function readBilledUsage(now = new Date()) {
  const result = await cloudflareGet("/billable-usage");
  const items = (Array.isArray(result) ? result : []) as Item[];
  const byProduct = new Map<string, number>();
  let start = 0;
  let end = 0;
  for (const item of items) {
    const name = text(item.ProductFamily) || text(item.x_ProductFamily) || text(item.ServiceName) || text(item.ServiceCategory) || text(item.ChargeDescription) || "Other";
    const dollars = Number(item.BilledCost ?? item.ContractedCost ?? item.EffectiveCost ?? 0) || 0;
    byProduct.set(name, (byProduct.get(name) || 0) + dollars * 100);
    const s = time(item.ChargePeriodStart) || time(item.BillingPeriodStart);
    const e = time(item.BillingPeriodEnd);
    if (s && (!start || s < start)) start = s;
    if (e && e > end) end = e;
  }
  // The period's end, when the records do not say: one month after its start (Cloudflare bills monthly).
  if (!start) start = periodAround(now, now.getUTCDate()).start;
  if (!end || end <= start) end = periodAround(new Date(start + DAY / 2), new Date(start).getUTCDate()).end;
  const products: ProductLine[] = [...byProduct.entries()].map(([name, cents]) => ({ name, cents: Math.round(cents * 100) / 100 })).filter((line) => line.cents > 0).sort((a, b) => b.cents - a.cents);
  return { products, periodStart: start, periodEnd: end };
}

/* Fallback: Cloudflare's usage analytics for the calendar month, priced at its published rates. */
const ESTIMATE_PRODUCT: Record<CategoryKey, string> = {
  requests: "Workers", cpu: "Workers", d1Read: "D1", d1Write: "D1", d1Storage: "D1", r2Storage: "R2", r2A: "R2", r2B: "R2",
  ai: "Workers AI", containers: "Containers", containerCpu: "Containers", containerDisk: "Containers",
};
async function estimatedUsage(env: Env, now: Date) {
  const { usage } = await readCloudflareUsage(env, now);
  const priced = priceAll(usage);
  const byProduct = new Map<string, number>();
  for (const row of priced.rows) { const name = ESTIMATE_PRODUCT[row.key]; byProduct.set(name, (byProduct.get(name) || 0) + row.overageCents); }
  const products: ProductLine[] = [...byProduct.entries()].map(([name, cents]) => ({ name, cents: Math.round(cents * 100) / 100 })).filter((line) => line.cents > 0).sort((a, b) => b.cents - a.cents);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return { products, periodStart: start, periodEnd: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) };
}

/* The editing machines' measured use since `from`, by feature label (list-price dollars, used as weights). */
export async function machineUseByFeature(from: number, now = new Date()) {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rows = await query("containersUsageAdaptiveGroups", `limit: 100, filter: { date_geq: "${day(from)}", date_leq: "${day(now.getTime())}" }`, `dimensions { feature: label(name: "feature") } sum { cpuTimeSec allocatedMemory allocatedDisk }`);
  const out: Record<string, number> = {};
  for (const row of rows as { dimensions?: { feature?: string | null }; sum?: Record<string, number> }[]) {
    const key = row.dimensions?.feature || "untagged";
    out[key] = (out[key] || 0) + machineDollars(row.sum || {});
  }
  return out;
}

export type CloudflareBill = Awaited<ReturnType<typeof readBill>>;

export async function readBill(env: Env, now = new Date()) {
  if (!cloudflareConnected()) return { connected: false as const };
  let source: "billing" | "estimate" = "billing";
  let billingProblem = "";
  let usage: Awaited<ReturnType<typeof readBilledUsage>>;
  try { usage = await readBilledUsage(now); }
  catch (error) {
    source = "estimate";
    billingProblem = String(error instanceof Error ? error.message : error).slice(0, 160);
    usage = await estimatedUsage(env, now);
  }
  let machines: Record<string, number> = {};
  let machineProblem = "";
  try { machines = await machineUseByFeature(usage.periodStart, now); }
  catch (error) { machineProblem = String(error instanceof Error ? error.message : error).slice(0, 160); }
  const usageCents = usage.products.reduce((sum, line) => sum + line.cents, 0);
  const pace = projection(usageCents, usage.periodStart, usage.periodEnd, now.getTime());
  return {
    connected: true as const,
    at: now.getTime(),
    source,
    billingProblem,
    machineProblem,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
    planCents: PLAN_CENTS,
    usageCents: Math.round(usageCents * 100) / 100,
    ...pace,
    products: usage.products,
    features: byFeature(usage.products, machines, source === "estimate"),
  };
}
