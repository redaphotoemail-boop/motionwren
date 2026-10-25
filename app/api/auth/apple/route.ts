const STATE_COOKIE = "motionwren_apple_state";
const STATE_MAX_AGE = 10 * 60;

function cookie(value: string, maxAge: number) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const clientId = String(env.APPLE_CLIENT_ID || "");
  if (!clientId) return new Response("Apple sign-in is not configured.", { status: 503 });

  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(stateBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const redirectUri = new URL("/api/auth/apple/callback", request.url).toString();
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", scope: "name email", redirect_uri: redirectUri, state, response_mode: "form_post" });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://appleid.apple.com/auth/authorize?${params.toString()}`,
      "Set-Cookie": cookie(state, STATE_MAX_AGE),
    },
  });
}
