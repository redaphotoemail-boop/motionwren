import { heartbeatKey } from "../_lib/heartbeat";
import { advanceStaleJobs } from "../_lib/render-jobs";

/* Called once a minute by the Worker's scheduled event (never from a browser):
   1. moves along every video in production (missed callbacks, scheduled
      retries, provider waits) — no video depends on an open page;
   2. deletes a finished video's working files (scene photos, scene copies,
      manifest) 30 days after it finished. The finished film itself stays in
      History for its own retention period. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const secret = process.env.REPLICATE_API_TOKEN;
  const supplied = request.headers.get("x-motionwren-heartbeat") || "";
  if (!secret || supplied.length !== 64 || supplied !== await heartbeatKey(secret)) return Response.json({ error: "Not found." }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  const moved = await advanceStaleJobs(env, new URL(request.url).origin, null, 10);
  const cleaned = await cleanUp(env).catch(() => 0);
  return Response.json({ ok: true, moved, cleaned });
}

async function cleanUp(env: { DB: D1Database; BUCKET: R2Bucket }) {
  const cursorRow = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'cleanup_cursor'`).first<{ value?: string }>();
  const cursor = Number(cursorRow?.value || 0);
  const rows = await env.DB.prepare(`SELECT id, updated_at AS updatedAt FROM render_jobs WHERE status IN ('succeeded', 'failed') AND updated_at > ? AND updated_at < ? ORDER BY updated_at ASC LIMIT 5`).bind(cursor, Date.now() - RETENTION_MS).all<{ id: string; updatedAt: number }>();
  for (const row of rows.results) {
    const listed = await env.BUCKET.list({ prefix: `render-jobs/${row.id}/` });
    const keys = listed.objects.map((object: { key: string }) => object.key);
    if (keys.length) await env.BUCKET.delete(keys);
  }
  if (rows.results.length) await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('cleanup_cursor', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(String(rows.results[rows.results.length - 1].updatedAt), Date.now()).run();
  return rows.results.length;
}
