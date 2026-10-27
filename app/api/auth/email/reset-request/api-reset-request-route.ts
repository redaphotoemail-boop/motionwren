import { enforceRateLimit, HttpError } from "../../../_lib/account";

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!validEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  try {
    await enforceRateLimit(env, "email-reset-request", email, 5, 60 * 60 * 1000);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    throw error;
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FRAME_MOTION_FROM_EMAIL;
  if (!apiKey || !from) {
    return Response.json({ error: "Password reset emails are not set up yet. Please try again later." }, { status: 503 });
  }
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first<{ id: string }>();
  if (!user) return Response.json({ ok: true });
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  try {
    await env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)").bind(crypto.randomUUID(), user.id, await hashToken(token), now + 60 * 60 * 1000, now).run();
  } catch {
    return Response.json({ error: "Password reset is not available yet. Please try again later." }, { status: 503 });
  }
  const link = `https://motionwren.com/signin/reset?token=${token}`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Reset your MotionWren password", text: `Reset your MotionWren password with this link (expires in 1 hour):\n\n${link}\n\nIf you did not ask for this, ignore this email.` }),
    });
  } catch {
    return Response.json({ error: "The reset email could not be sent. Please try again later." }, { status: 503 });
  }
  return Response.json({ ok: true });
}
