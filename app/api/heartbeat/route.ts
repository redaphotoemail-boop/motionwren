import { heartbeatKey } from "../_lib/heartbeat";
import { advanceStaleJobs } from "../_lib/render-jobs";

/* Called once a minute by the Worker's scheduled event (never from a browser). */
export async function POST(request: Request) {
  const secret = process.env.REPLICATE_API_TOKEN;
  const supplied = request.headers.get("x-motionwren-heartbeat") || "";
  if (!secret || supplied.length !== 64 || supplied !== await heartbeatKey(secret)) return Response.json({ error: "Not found." }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  const moved = await advanceStaleJobs(env, new URL(request.url).origin, null, 10);
  return Response.json({ ok: true, moved });
}
