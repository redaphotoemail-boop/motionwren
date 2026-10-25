import { createGoogleSession, configuredAdmins, enforceRateLimit, HttpError } from "../../../_lib/account";

const SESSION_COOKIE = "motionwren_session";

function sessionCookie(value: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(input: string) {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `${toBase64(salt)}:${toBase64(new Uint8Array(bits))}`;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let body: { email?: string; password?: string; displayName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim() || email;
  if (!validEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  try {
    await enforceRateLimit(env, "email-register", email, 5, 60 * 60 * 1000);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    throw error;
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first<{ id: string }>();
  if (existing) return Response.json({ error: "An account with this email already exists. Sign in with Google, or use a different email." }, { status: 400 });
  const isAdmin = configuredAdmins(env).has(email);
  const userId = `email:${email}`;
  const now = Date.now();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await hashPassword(password, salt);
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)`).bind(userId, email, displayName, isAdmin ? "admin" : "customer", isAdmin ? "internal" : "free", passwordHash, now, now).run();
  const session = await createGoogleSession(env, userId);
  return Response.json({ ok: true, redirect: isAdmin ? "/admin" : "/dashboard" }, { headers: { "Set-Cookie": sessionCookie(session.token, Math.floor((session.expiresAt - now) / 1000)) } });
}
