/* The video-engine provider (Replicate today), behind one small interface so
   another engine can be added later without touching orders, scenes,
   payment or delivery. Everything here runs on the server only.

   Errors are classified, because they need different handling:
   - throttled — the provider asked us to slow down (HTTP 429). Wait as long
     as it says (Retry-After / "resets in ~8s"), then try again. Never a
     failure.
   - credit    — the provider account is out of funds (HTTP 402). Production
     pauses for everyone and the manager is alerted; no video is failed.
   - transient — network trouble or a provider 5xx. Back off and retry.
   - rejected  — the provider refused this request (other 4xx). Counts as a
     failed try of that scene.

   Shared provider state (rate-limit wait, pause, last error) and the
   configured concurrency live in platform_settings, so every request,
   callback and the minute heartbeat see the same picture. */

export type ProviderErrorKind = "throttled" | "credit" | "transient" | "rejected";

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  status: number;
  retryAfterMs: number;
  constructor(kind: ProviderErrorKind, message: string, status = 0, retryAfterMs = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

type DbEnv = { DB: D1Database };

/* Local end-to-end tests point the provider at a mock (never set in production). */
const API = "https://api.replicate.com";
export function providerBase() {
  return (process.env.REPLICATE_API_BASE || API).replace(/\/$/, "");
}
export function providerUrl(url: string) {
  return url.startsWith(API) ? `${providerBase()}${url.slice(API.length)}` : url;
}

function retryAfterFrom(response: Response, detail: string) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = /resets? in ~?(\d+)\s*s/i.exec(detail);
  return match ? Number(match[1]) * 1000 : 0;
}

export function classify(status: number, detail: string, response?: Response): ProviderError {
  const retryAfter = response ? retryAfterFrom(response, detail) : 0;
  if (status === 429 || /throttl|rate limit/i.test(detail)) return new ProviderError("throttled", detail || "The video engine asked us to slow down.", status, retryAfter);
  if (status === 402 || /insufficient credit|billing|payment required/i.test(detail)) return new ProviderError("credit", detail || "The video engine account needs credit.", status);
  if (status >= 500 || status === 0) return new ProviderError("transient", detail || `The video engine is temporarily unavailable (${status}).`, status, retryAfter);
  return new ProviderError("rejected", detail || `The video engine refused the request (${status}).`, status);
}

/* Creates one prediction. One call, no internal retry: the queue decides
   when to try again, so waits are persisted and survive restarts. */
export async function createPrediction(token: string, endpoint: string, input: Record<string, unknown>, webhook?: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(providerUrl(endpoint), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input, ...(webhook ? { webhook, webhook_events_filter: ["completed"] } : {}) }),
    });
  } catch (error) {
    throw new ProviderError("transient", `The video engine could not be reached${error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : ""}.`);
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.ok && typeof data.id === "string") return data.id;
  throw classify(response.status, String(data.detail || data.error || data.title || ""), response);
}

/* ---------- shared provider state ---------- */

export type ProviderState = {
  throttledUntil: number; // no new requests before this time
  pausedUntil: number;    // out of credit: paused for everyone until then
  lowCredit: boolean;     // the provider said the account is low on credit
  lastError: string;
  lastErrorAt: number;
  lastSubmitAt: number;
};

const STATE_KEY = "provider_state";
const EMPTY: ProviderState = { throttledUntil: 0, pausedUntil: 0, lowCredit: false, lastError: "", lastErrorAt: 0, lastSubmitAt: 0 };

export async function readProviderState(env: DbEnv): Promise<ProviderState> {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(STATE_KEY).first<{ value?: string }>().catch(() => null);
  try { return { ...EMPTY, ...(row?.value ? JSON.parse(row.value) as Partial<ProviderState> : {}) }; } catch { return { ...EMPTY }; }
}

export async function writeProviderState(env: DbEnv, change: Partial<ProviderState>) {
  const next = { ...(await readProviderState(env)), ...change };
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(STATE_KEY, JSON.stringify(next), Date.now()).run();
  return next;
}

/* How many scenes may be with the provider at once, across every video.
   Default 1 (a provider account under $5 of credit allows a burst of one
   request). Raise it in the Studio's production health panel, or with the
   REPLICATE_MAX_ACTIVE environment variable, once the account allows more. */
export async function maxActive(env: DbEnv) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'provider_max_active'`).first<{ value?: string }>().catch(() => null);
  const value = Number(row?.value || process.env.REPLICATE_MAX_ACTIVE || 1);
  return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1;
}

/* ---------- leases (short locks that expire on their own) ---------- */

export async function acquireLease(env: DbEnv, key: string, ttlMs: number): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)`).bind(key, token, now).run();
  if (inserted.meta.changes) return token;
  const taken = await env.DB.prepare(`UPDATE platform_settings SET value = ?, updated_at = ? WHERE key = ? AND updated_at < ?`).bind(token, now, key, now - ttlMs).run();
  return taken.meta.changes ? token : null;
}

export async function releaseLease(env: DbEnv, key: string, token: string) {
  await env.DB.prepare(`DELETE FROM platform_settings WHERE key = ? AND value = ?`).bind(key, token).run().catch(() => undefined);
}

/* Backoff with jitter: base·2^(n-1), capped, plus up to 30% random. */
export function backoff(n: number, baseMs: number, capMs: number) {
  const plain = Math.min(capMs, baseMs * 2 ** Math.max(0, n - 1));
  return Math.round(plain + Math.random() * plain * 0.3);
}
