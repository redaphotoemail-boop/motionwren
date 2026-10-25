import { deleteGoogleSession, readCookie } from "../../_lib/account";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  await deleteGoogleSession(env, readCookie(request.headers.get("cookie"), "motionwren_session"));
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Set-Cookie": "motionwren_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    },
  });
}

export const POST = GET;
