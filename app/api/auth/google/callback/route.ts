import { createGoogleSession, configuredAdmins, readCookie } from "../../../_lib/account";

const STATE_COOKIE = "motionwren_google_state";
const SESSION_COOKIE = "motionwren_session";

function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function sessionCookie(value: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirectWithCookie(request: Request, location: string, setCookie: string) {
  const response = Response.redirect(new URL(location, request.url), 302);
  response.headers.append("Set-Cookie", setCookie);
  return response;
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const url = new URL(request.url);
  const stateCookie = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!stateCookie || !state || stateCookie !== state || !code) return redirectWithCookie(request, "/?owner=restricted", clearStateCookie());

  const clientId = String(env.GOOGLE_CLIENT_ID || "");
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "");
  if (!clientId || !clientSecret) return redirectWithCookie(request, "/?owner=restricted", clearStateCookie());

  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return redirectWithCookie(request, "/?owner=restricted", clearStateCookie());
  const tokens = await tokenResponse.json() as { access_token?: string };
  if (!tokens.access_token) return redirectWithCookie(request, "/?owner=restricted", clearStateCookie());

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) return redirectWithCookie(request, "/?owner=restricted", clearStateCookie());
  const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  const email = String(profile.email || "").trim().toLowerCase();
  if (!email || profile.email_verified === false || !configuredAdmins(env).has(email)) return redirectWithCookie(request, "/?owner=restricted", clearStateCookie());

  const userId = `google:${profile.sub || email}`;
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', 'internal', 0, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, role = 'admin', status = 'active', updated_at = excluded.updated_at`).bind(userId, email, profile.name || email, now, now).run();
  const session = await createGoogleSession(env, userId);
  const response = Response.redirect(new URL("/admin", request.url), 302);
  response.headers.append("Set-Cookie", clearStateCookie());
  response.headers.append("Set-Cookie", sessionCookie(session.token, Math.floor((session.expiresAt - now) / 1000)));
  return response;
}
