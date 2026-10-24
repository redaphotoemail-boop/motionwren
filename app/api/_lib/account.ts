import { getChatGPTUser } from "../../chatgpt-auth";

export type Account = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "customer";
  status: string;
  plan: string;
  creditBalance: number;
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function configuredAdmins() {
  return new Set((process.env.FRAME_MOTION_ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export async function requireAccount(env: { DB: D1Database }): Promise<Account> {
  const identity = await getChatGPTUser();
  if (!identity) throw new HttpError(401, "Authentication required.");
  const now = Date.now();
  const role = configuredAdmins().has(identity.email.toLowerCase()) ? "admin" : "customer";
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE excluded.role END, updated_at = excluded.updated_at`).bind(identity.id, identity.email, identity.displayName, role, role === "admin" ? "internal" : "free", now, now).run();
  const account = await env.DB.prepare(`SELECT id, email, display_name AS displayName, role, status, plan, credit_balance AS creditBalance FROM users WHERE id = ? LIMIT 1`).bind(identity.id).first<Account>();
  if (!account || account.status !== "active") throw new HttpError(403, "This account is not active.");
  return account;
}

export async function requireAdmin(env: { DB: D1Database }) {
  const account = await requireAccount(env);
  if (account.role !== "admin") throw new HttpError(403, "Administrator access required.");
  return account;
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "The request could not be completed." }, { status: 500 });
}

export async function audit(env: { DB: D1Database }, actorId: string, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await env.DB.prepare(`INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), actorId, action, entityType, entityId || null, JSON.stringify(metadata), Date.now()).run();
}

export async function enforceRateLimit(env: { DB: D1Database }, actorId: string, action: string, limit: number, windowMs: number) {
  const now = Date.now();
  const key = `${actorId}:${action}`;
  await env.DB.prepare(`INSERT INTO rate_limits (key, count, window_started_at, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.window_started_at < ? THEN 1 ELSE rate_limits.count + 1 END, window_started_at = CASE WHEN rate_limits.window_started_at < ? THEN ? ELSE rate_limits.window_started_at END, updated_at = ?`).bind(key, now, now, now - windowMs, now - windowMs, now, now).run();
  const row = await env.DB.prepare(`SELECT count, window_started_at AS windowStartedAt FROM rate_limits WHERE key = ? LIMIT 1`).bind(key).first<{ count: number; windowStartedAt: number }>();
  if (row && row.count > limit) {
    const retrySeconds = Math.max(1, Math.ceil((row.windowStartedAt + windowMs - now) / 1000));
    throw new HttpError(429, `Too many requests. Try again in ${retrySeconds} seconds.`);
  }
}
