import { createGoogleSession, configuredAdmins, readCookie } from "../../../_lib/account";

const STATE_COOKIE = "motionwren_apple_state";
const SESSION_COOKIE = "motionwren_session";

function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function sessionCookie(value: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirectWithCookie(request: Request, location: string, setCookie: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(location, request.url).toString(),
      "Set-Cookie": setCookie,
    },
  });
}

function base64urlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64urlDecode(input: string) {
  return base64ToBytes(input);
}

function textFromBase64url(input: string) {
  return new TextDecoder().decode(base64urlDecode(input));
}

async function makeClientSecret(env: { APPLE_CLIENT_ID?: string; APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_PRIVATE_KEY?: string }) {
  const clientId = String(env.APPLE_CLIENT_ID || "");
  const teamId = String(env.APPLE_TEAM_ID || "");
  const keyId = String(env.APPLE_KEY_ID || "");
  const pem = String(env.APPLE_PRIVATE_KEY || "");
  if (!clientId || !teamId || !keyId || !pem) throw new Error("Apple sign-in is not configured.");
  const inner = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const keyData = base64ToBytes(inner);
  const key = await crypto.subtle.importKey("pkcs8", keyData.buffer as ArrayBuffer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })));
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({ iss: teamId, iat: now, exp: now + 3600, aud: "https://appleid.apple.com", sub: clientId })));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
  return `${header}.${payload}.${base64urlEncode(new Uint8Array(signature))}`;
}

async function verifyIdToken(idToken: string, clientId: string) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid Apple identity token.");
  const header = JSON.parse(textFromBase64url(parts[0])) as { alg?: string; kid?: string };
  const claims = JSON.parse(textFromBase64url(parts[1])) as { iss?: string; aud?: string; exp?: number; sub?: string; email?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("Invalid Apple identity token.");
  if (claims.iss !== "https://appleid.apple.com" || claims.aud !== clientId || !claims.exp || claims.exp * 1000 <= Date.now()) throw new Error("Invalid Apple identity token.");
  const jwksResponse = await fetch("https://appleid.apple.com/auth/keys");
  if (!jwksResponse.ok) throw new Error("Could not load Apple signing keys.");
  const jwks = await jwksResponse.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const jwk = (jwks.keys || []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Unknown Apple signing key.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("Invalid Apple identity token signature.");
  return claims;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const fail = () => redirectWithCookie(request, "/signin?error=apple", clearStateCookie());
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail();
  }
  const stateCookie = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  const state = form.get("state");
  const code = form.get("code");
  if (!stateCookie || !state || stateCookie !== state || !code) return fail();

  const clientId = String(env.APPLE_CLIENT_ID || "");
  if (!clientId) return fail();
  let clientSecret: string;
  try {
    clientSecret = await makeClientSecret(env);
  } catch {
    return fail();
  }
  const redirectUri = new URL("/api/auth/apple/callback", request.url).toString();
  const tokenResponse = await fetch("https://appleid.apple.com/auth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: String(code), grant_type: "authorization_code", redirect_uri: redirectUri }) });
  if (!tokenResponse.ok) return fail();
  const tokens = await tokenResponse.json() as { id_token?: string };
  if (!tokens.id_token) return fail();
  let claims: { sub?: string; email?: string };
  try {
    claims = await verifyIdToken(tokens.id_token, clientId);
  } catch {
    return fail();
  }
  const email = String(claims.email || "").trim().toLowerCase();
  if (!email) return fail();

  let displayName = email;
  try {
    const userJson = form.get("user");
    if (typeof userJson === "string") {
      const user = JSON.parse(userJson) as { name?: { firstName?: string; lastName?: string } };
      const full = `${user?.name?.firstName || ""} ${user?.name?.lastName || ""}`.trim();
      if (full) displayName = full;
    }
  } catch {
    // Apple only sends the name on first sign-in; fall back to the email.
  }

  const isAdmin = configuredAdmins(env).has(email);
  const userId = `apple:${claims.sub || email}`;
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO users (id, email, display_name, role, status, plan, credit_balance, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE excluded.role END, status = 'active', updated_at = excluded.updated_at`).bind(userId, email, displayName, isAdmin ? "admin" : "customer", isAdmin ? "internal" : "free", now, now).run();
  const session = await createGoogleSession(env, userId);
  const headers = new Headers({ Location: new URL(isAdmin ? "/admin" : "/dashboard", request.url).toString() });
  headers.append("Set-Cookie", clearStateCookie());
  headers.append("Set-Cookie", sessionCookie(session.token, Math.floor((session.expiresAt - now) / 1000)));
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  return Response.redirect(new URL("/signin", request.url), 302);
}
