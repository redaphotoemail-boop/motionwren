const STATE_COOKIE = "motionwren_google_state";
const STATE_MAX_AGE = 10 * 60;

function cookie(value: string, maxAge: number) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const clientId = String(env.GOOGLE_CLIENT_ID || "");
  if (!clientId) return new Response("Google sign-in is not configured.", { status: 503 });

  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(stateBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", scope: "openid email profile", redirect_uri: redirectUri, state, access_type: "online", prompt: "select_account" });
  const response = Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
  response.headers.append("Set-Cookie", cookie(state, STATE_MAX_AGE));
  return response;
}
