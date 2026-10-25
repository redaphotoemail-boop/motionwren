import { deleteGoogleSession, readCookie } from "../../_lib/account";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  await deleteGoogleSession(env, readCookie(request.headers.get("cookie"), "motionwren_session"));
  const response = Response.redirect(new URL("/", request.url), 302);
  response.headers.append("Set-Cookie", "motionwren_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  return response;
}

export const POST = GET;
