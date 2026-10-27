import { enforceRateLimit, HttpError } from "../../../_lib/account";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function hashPassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `${toBase64(salt)}:${toBase64(new Uint8Array(bits))}`;
}

async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const token = String(body.token || "");
  const password = String(body.password || "");
  if (!token) return Response.json({ error: "A reset link is required." }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  const tokenHash = await hashToken(token);
  try {
    await enforceRateLimit(env, "email-reset", tokenHash.slice(0, 16), 10, 60 * 60 * 1000);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    throw error;
  }
  let row: { user_id: string; expires_at: number; used_at: number | null } | null;
  try {
    row = await env.DB.prepare("SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1").bind(tokenHash).first<{ user_id: string; expires_at: number; used_at: number | null }>();
  } catch {
    return Response.json({ error: "Password reset is not available yet. Please try again later." }, { status: 503 });
  }
  if (!row || row.used_at || row.expires_at < Date.now()) {
    return Response.json({ error: "This reset link is invalid or expired. Request a new one." }, { status: 400 });
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, salt);
  const now = Date.now();
  await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(passwordHash, now, row.user_id).run();
  await env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(row.user_id).run();
  return Response.json({ ok: true });
}
