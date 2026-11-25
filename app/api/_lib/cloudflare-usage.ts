/* Cloudflare's own usage for the month so far, read from its analytics API with a read-only token the owner adds as
   secrets (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID). Each category is asked for on its own, so one that Cloudflare
   does not answer shows as "not available" and never hides the rest. Nothing here changes anything at Cloudflare. */

import { AI_FREE_PER_DAY, CONTAINER_GIB_HOURS_PER_FILM, aiBillableNeurons, priceAll, r2Class, type CategoryKey, type Usage } from "../../cloudflare-cost";

const secret = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

type Env = { DB: D1Database } & Record<string, unknown>;
type Rows = Record<string, unknown>[];

export const cloudflareConnected = () => Boolean(secret("CLOUDFLARE_API_TOKEN") && secret("CLOUDFLARE_ACCOUNT_ID"));

export function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { start: start.toISOString(), end: now.toISOString(), startDay: day(start), endDay: day(now), startMs: start.getTime() };
}

export async function query(dataset: string, args: string, body: string): Promise<Rows> {
  const account = secret("CLOUDFLARE_ACCOUNT_ID")!;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret("CLOUDFLARE_API_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query { viewer { accounts(filter: { accountTag: "${account}" }) { ${dataset}(${args}) { ${body} } } } }` }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as { data?: { viewer?: { accounts?: Record<string, Rows>[] } }; errors?: { message?: string }[] } | null;
  if (!response.ok || data?.errors?.length) throw new Error(String(data?.errors?.[0]?.message || `Cloudflare answered HTTP ${response.status}.`).slice(0, 160));
  return data?.data?.viewer?.accounts?.[0]?.[dataset] || [];
}

const sum = (rows: Rows, path: (row: Record<string, any>) => unknown) => rows.reduce((total, row) => total + (Number(path(row as Record<string, any>)) || 0), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
const GB = 1024 ** 3;

export type UsageResult = { usage: Usage; problems: Partial<Record<CategoryKey, string>> };

export async function readCloudflareUsage(env: Env, now = new Date()): Promise<UsageResult> {
  const w = monthWindow(now);
  const time = `datetime_geq: "${w.start}", datetime_leq: "${w.end}"`;
  const days = `date_geq: "${w.startDay}", date_leq: "${w.endDay}"`;
  const usage: Usage = {};
  const problems: UsageResult["problems"] = {};
  const attempt = async (keys: CategoryKey[], run: () => Promise<void>) => {
    try { await run(); } catch (error) { for (const key of keys) problems[key] = String(error instanceof Error ? error.message : error).slice(0, 160); }
  };
  await Promise.all([
    attempt(["requests"], async () => { usage.requests = sum(await query("workersInvocationsAdaptive", `limit: 10000, filter: { ${time} }`, "sum { requests }"), (row) => row.sum?.requests); }),
    attempt(["cpu"], async () => { usage.cpu = sum(await query("workersInvocationsAdaptive", `limit: 10000, filter: { ${time} }`, "sum { cpuTimeUs }"), (row) => Number(row.sum?.cpuTimeUs) / 1000); }),
    attempt(["d1Read", "d1Write"], async () => {
      const rows = await query("d1AnalyticsAdaptiveGroups", `limit: 10000, filter: { ${days} }`, "sum { rowsRead rowsWritten }");
      usage.d1Read = sum(rows, (row) => row.sum?.rowsRead); usage.d1Write = sum(rows, (row) => row.sum?.rowsWritten);
    }),
    attempt(["d1Storage"], async () => {
      const rows = await query("d1StorageAdaptiveGroups", `limit: 10000, filter: { ${days} }, orderBy: [date_DESC]`, "max { databaseSizeBytes } dimensions { databaseId date }");
      const latest = new Map<string, number>();
      for (const row of rows as Record<string, any>[]) { const id = String(row.dimensions?.databaseId); if (!latest.has(id)) latest.set(id, Number(row.max?.databaseSizeBytes) || 0); } // eslint-disable-line @typescript-eslint/no-explicit-any
      usage.d1Storage = [...latest.values()].reduce((a, b) => a + b, 0) / GB;
    }),
    attempt(["r2Storage"], async () => {
      const rows = await query("r2StorageAdaptiveGroups", `limit: 100, filter: { ${time} }, orderBy: [datetime_DESC]`, "max { payloadSize metadataSize } dimensions { bucketName datetime }");
      const latest = new Map<string, number>();
      for (const row of rows as Record<string, any>[]) { const id = String(row.dimensions?.bucketName); if (!latest.has(id)) latest.set(id, (Number(row.max?.payloadSize) || 0) + (Number(row.max?.metadataSize) || 0)); } // eslint-disable-line @typescript-eslint/no-explicit-any
      usage.r2Storage = [...latest.values()].reduce((a, b) => a + b, 0) / GB;
    }),
    attempt(["r2A", "r2B"], async () => {
      const rows = await query("r2OperationsAdaptiveGroups", `limit: 10000, filter: { ${time} }`, "sum { requests } dimensions { actionType }") as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      usage.r2A = 0; usage.r2B = 0;
      for (const row of rows) { const kind = r2Class(String(row.dimensions?.actionType)); const count = Number(row.sum?.requests) || 0; if (kind === "A") usage.r2A += count; else if (kind === "B") usage.r2B += count; }
    }),
    attempt(["ai"], async () => {
      const rows = await query("aiInferenceAdaptiveGroups", `limit: 10000, filter: { ${time} }`, "sum { totalNeurons } dimensions { date }") as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const perDay = new Map<string, number>();
      for (const row of rows) { const day = String(row.dimensions?.date); perDay.set(day, (perDay.get(day) || 0) + (Number(row.sum?.totalNeurons) || 0)); }
      usage.ai = aiBillableNeurons([...perDay.values()]);
    }),
    attempt(["containers", "containerCpu", "containerDisk"], async () => {
      // The editing machines' billed usage, as Cloudflare counts it (memory and disk for as long as a machine is on).
      try {
        const rows = await query("containersUsageAdaptiveGroups", `limit: 100, filter: { ${days} }`, "sum { cpuTimeSec allocatedMemory allocatedDisk }");
        usage.containers = sum(rows, (row) => row.sum?.allocatedMemory) / GB / 3600;
        usage.containerCpu = sum(rows, (row) => row.sum?.cpuTimeSec) / 60;
        usage.containerDisk = sum(rows, (row) => row.sum?.allocatedDisk) / 1e9 / 3600;
      } catch (error) {
        // Not answered: memory is estimated from our own finished films, and processing and disk show as not available.
        const row = await env.DB.prepare(`SELECT COUNT(*) AS films FROM render_jobs WHERE status = 'succeeded' AND kind IN ('customer-series','studio-series') AND created_at >= ?`).bind(w.startMs).first<{ films: number }>();
        usage.containers = (Number(row?.films) || 0) * CONTAINER_GIB_HOURS_PER_FILM;
        const reason = String(error instanceof Error ? error.message : error).slice(0, 160);
        problems.containerCpu = reason; problems.containerDisk = reason;
      }
    }),
  ]);
  return { usage, problems };
}

export async function cloudflareReport(env: Env) {
  if (!cloudflareConnected()) return { connected: false as const };
  const { usage, problems } = await readCloudflareUsage(env);
  const priced = priceAll(usage);
  return { connected: true as const, at: Date.now(), since: monthWindow().start, freeAiPerDay: AI_FREE_PER_DAY, ...priced, problems };
}
