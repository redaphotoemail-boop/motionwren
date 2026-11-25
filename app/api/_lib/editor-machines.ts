/* The watchdog over the editing machines (Cloudflare Containers, worker/composer.ts).

   Why: in November 2026 machines stayed on for days after their work was done and ran up a bill (about 800
   machine-hours for a handful of films). The cause was fixed, and this is the safety net in case anything ever
   keeps a machine on again:

   1. Every machine the site uses is written down with when it was last used (composer.ts noteMachine).
   2. Every 10 minutes the heartbeat knocks on each machine nobody has used for 45 minutes and that is not
      working on a film or reading still in progress. The machine answers the knock itself (worker/composer.ts)
      without starting, and stops only if it is running and has really been idle (it keeps its own record too).
   3. Once an hour, when the read-only Cloudflare token is set, today's real editing-machine spend is read
      from Cloudflare. Over the daily limit, the managers are alerted (in the app and by email) and the
      watchdog runs at once with a shorter idle time (still 30 minutes at least).

   Nothing here ever stops a film mid-edit, starts a machine, or changes anything at Cloudflare. */

import { MACHINES_TABLE, composerBinding } from "./composer";
import { cloudflareConnected, query } from "./cloudflare-usage";
import { alertManagers } from "./scene-queue";

type Env = { DB: D1Database } & Record<string, unknown>;

export const SLEEP_PATH = "/__motionwren/sleep"; // must match worker/composer.ts
export const IDLE_MS = 45 * 60 * 1000;
export const ALERT_IDLE_MS = 30 * 60 * 1000;
const PER_SWEEP = 20;
const FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_DAILY_LIMIT_DOLLARS = 1;

/* Cloudflare Containers rates (Workers Paid), before the monthly free allowance: an upper bound for the day. */
export function containerDollars(sum: { allocatedMemory?: number; cpuTimeSec?: number; allocatedDisk?: number }) {
  const GIB = 1024 ** 3;
  const GB = 1000 ** 3;
  return (Number(sum.allocatedMemory) || 0) / GIB * 0.0000025 + (Number(sum.cpuTimeSec) || 0) * 0.00002 + (Number(sum.allocatedDisk) || 0) / GB * 0.00000007;
}

/* Machine names that belong to work still going on, so they are never knocked on. A film's edit runs on a
   machine named after the film; a WrenCut reading on wrencut-<job>; a template preview on wrenprev-<id>. */
export function busyName(name: string, active: Set<string>) {
  if (active.has(name)) return true;
  const m = /^(?:wrencut|wrenprev)-(.+)$/.exec(name);
  return Boolean(m && active.has(m[1]));
}

export type WatchState = { lastSweepAt?: number; stoppedToday?: number; day?: string; lastStoppedAt?: number; spendCheckedAt?: number; todayDollars?: number | null; spendError?: string };

export async function readWatchdog(env: Env): Promise<WatchState> {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'editor_watchdog'`).first<{ value?: string }>().catch(() => null);
  try { return JSON.parse(row?.value || "{}"); } catch { return {}; }
}
async function saveState(env: Env, patch: WatchState) {
  const next = { ...await readWatchdog(env), ...patch };
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('editor_watchdog', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(next), Date.now()).run().catch(() => undefined);
}

export async function sweepIdleMachines(env: Env, idleMs = IDLE_MS, now = Date.now()) {
  const namespace = composerBinding(env);
  if (!namespace) return { checked: 0, stopped: 0 };
  await env.DB.prepare(MACHINES_TABLE).run();
  const rows = await env.DB.prepare(`SELECT name FROM editor_machines WHERE last_used < ? AND (stopped_at IS NULL OR stopped_at < last_used) ORDER BY last_used ASC LIMIT ?`).bind(now - idleMs, PER_SWEEP).all<{ name: string }>();
  if (!rows.results.length) {
    // Old entries are dropped from the list after a week.
    await env.DB.prepare(`DELETE FROM editor_machines WHERE last_used < ?`).bind(now - FORGET_AFTER_MS).run().catch(() => undefined);
    return { checked: 0, stopped: 0 };
  }
  const active = new Set<string>((await env.DB.prepare(`SELECT id FROM render_jobs WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'canceled')`).all<{ id: string }>()).results.map((row) => row.id));
  const reads = await env.DB.prepare(`SELECT job FROM wrencut_reads WHERE status IN ('running', 'saving')`).all<{ job: string }>().catch(() => ({ results: [] as { job: string }[] }));
  for (const row of reads.results) active.add(row.job);
  let stopped = 0;
  let checked = 0;
  const started = Date.now();
  for (const { name } of rows.results) {
    if (Date.now() - started > 30_000) break; // the rest wait for the next sweep
    if (busyName(name, active)) continue;
    checked++;
    try {
      // The raw stub on purpose: knocking must not count as using the machine.
      const target = namespace.getByName ? namespace.getByName(name) : namespace.get(namespace.idFromName(name));
      const response = await target.fetch(`http://composer${SLEEP_PATH}?idle=${Math.max(ALERT_IDLE_MS, idleMs)}`, { signal: AbortSignal.timeout(5_000) });
      const answer = await response.json().catch(() => ({})) as { stopped?: boolean; reason?: string };
      if (answer.stopped) stopped++;
      // "in use" or "replying" means it was busy after all: look again next time. Otherwise it is asleep now.
      if (answer.reason !== "in use" && answer.reason !== "replying") await env.DB.prepare(`UPDATE editor_machines SET stopped_at = ? WHERE name = ?`).bind(now, name).run();
    } catch { /* tried again on the next sweep */ }
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const state = await readWatchdog(env);
  await saveState(env, { lastSweepAt: now, day, stoppedToday: (state.day === day ? state.stoppedToday || 0 : 0) + stopped, ...(stopped ? { lastStoppedAt: now } : {}) });
  if (stopped) console.log(`Editor watchdog: put ${stopped} idle machine(s) to sleep.`);
  return { checked, stopped };
}

export async function dailyLimitDollars(env: Env) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'container_daily_limit_dollars'`).first<{ value?: string }>().catch(() => null);
  const value = Number(row?.value);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DAILY_LIMIT_DOLLARS;
}

/* Today's (UTC) real editing-machine usage from Cloudflare, in dollars. Null when the token is not set. */
export async function todaysContainerDollars(now = new Date()) {
  if (!cloudflareConnected()) return null;
  const day = now.toISOString().slice(0, 10);
  const rows = await query("containersUsageAdaptiveGroups", `limit: 10, filter: { date_geq: "${day}", date_leq: "${day}" }`, "sum { cpuTimeSec allocatedMemory allocatedDisk }");
  return rows.reduce((total, row) => total + containerDollars((row as { sum?: Record<string, number> }).sum || {}), 0);
}

export async function checkSpend(env: Env, now = new Date()) {
  let dollars: number | null = null;
  try { dollars = await todaysContainerDollars(now); }
  catch (error) { await saveState(env, { spendCheckedAt: now.getTime(), spendError: String(error instanceof Error ? error.message : error).slice(0, 160) }); return { dollars: null, over: false }; }
  await saveState(env, { spendCheckedAt: now.getTime(), todayDollars: dollars, spendError: "" });
  if (dollars === null) return { dollars, over: false };
  const limit = await dailyLimitDollars(env);
  if (dollars <= limit) return { dollars, over: false };
  const swept = await sweepIdleMachines(env, ALERT_IDLE_MS, now.getTime()).catch(() => ({ checked: 0, stopped: 0 }));
  await alertManagers(env as unknown as Parameters<typeof alertManagers>[0], "Editing machines over the daily limit",
    `Cloudflare shows $${dollars.toFixed(2)} of editing-machine time today, over the $${limit.toFixed(2)} daily limit. ` +
    `The watchdog put ${swept.stopped} idle machine(s) to sleep; films still being edited were left alone. ` +
    `Check Admin, Finance, and Cloudflare's Containers page if it keeps rising.`);
  return { dollars, over: true, stopped: swept.stopped };
}

/* Called by the heartbeat every minute; sweeps on the 10-minute marks and checks the spend at :05 each hour. */
export async function watchMachines(env: Env, now = new Date()) {
  const minute = now.getUTCMinutes();
  const out: { sweep?: { checked: number; stopped: number }; spend?: { dollars: number | null; over: boolean } } = {};
  if (minute % 10 === 0) out.sweep = await sweepIdleMachines(env, IDLE_MS, now.getTime()).catch(() => undefined);
  if (minute === 5) out.spend = await checkSpend(env, now).catch(() => undefined);
  return out;
}
