import { createGoogleSession, configuredAdmins, enforceRateLimit, HttpError } from "../../../_lib/account";

const SESSION_COOKIE = "motionwren_session";

function sessionCookie(value: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function fromBase64(input: string) {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function verifyPassword(password: string, stored: string) {
  const separator = stored.indexOf(":");
  if (separator < 1) return false;
  const salt = fromBase64(stored.slice(0, separator));
  const expected = stored.slice(separator + 1);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" }, key, 256);
  return toBase64(new Uint8Array(bits)) === expected;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return Response.json({ error: "Enter your email and password." }, { status: 400 });
  try {
    await enforceRateLimit(env, "email-login", email, 10, 15 * 60 * 1000);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    throw error;
  }
  const row = await env.DB.prepare("SELECT id, email, role, status, password_hash AS passwordHash FROM users WHERE id = ? LIMIT 1").bind(`email:${email}`).first<{ id: string; email: string; role: string; status: string; passwordHash: string | null }>();
  if (!row || !row.passwordHash) return Response.json({ error: "No account with email sign-in for this address. Try Continue with Google, or create an account." }, { status: 401 });
  if (row.status !== "active") return Response.json({ error: "This account is not active." }, { status: 403 });
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return Response.json({ error: "Wrong email or password." }, { status: 401 });
  const isAdmin = configuredAdmins(env).has(row.email.toLowerCase());
  const now = Date.now();
  const session = await createGoogleSession(env, row.id);
  return Response.json({ ok: true, redirect: isAdmin ? "/admin" : "/dashboard" }, { headers: { "Set-Cookie": sessionCookie(session.token, Math.floor((session.expiresAt - now) / 1000)) } });
}
