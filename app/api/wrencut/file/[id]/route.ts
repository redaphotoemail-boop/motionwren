/* A stored file for the editing service, reachable only with its token. */
import { linkedKey } from "../../../_lib/wrencut";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const url = new URL(request.url);
  const id = url.pathname.split("/").at(-1) || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const key = await linkedKey(env, id, url.searchParams.get("token") || "");
  if (!key) return Response.json({ error: "Not found." }, { status: 404 });
  const object = await env.BUCKET.get(key);
  if (!object) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "no-store" } });
}
