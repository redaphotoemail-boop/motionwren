import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { advanceRenderJob, cancelProviderJob, getRenderJob, publicJob } from "../../_lib/render-jobs";
import { jsonError, requireAdmin } from "../../_lib/account";

function validId(id: string) { return /^[0-9a-f-]{36}$/i.test(id); }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const store = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || store.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "Reconnect the generation provider to resume this job." }, { status: 503 });
  let row = await getRenderJob(env, id, ownerId);
  if (!row) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const webhook = row.webhookToken ? `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${row.webhookToken}` : undefined;
  row = await advanceRenderJob(env, row, token, webhook) || row;
  return NextResponse.json({ job: publicJob(row) });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  let ownerId: string;
  try { ownerId = (await requireAdmin(env)).id; } catch (error) { return jsonError(error); }
  const store = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || store.get("wan_replicate_token")?.value;
  const row = await getRenderJob(env, id, ownerId);
  if (!row) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (token) {
    const ids = [...JSON.parse(row.predictionIds || "[]") as string[], ...(row.stitchPredictionId ? [row.stitchPredictionId] : [])];
    await Promise.allSettled(ids.map((predictionId) => cancelProviderJob(token, predictionId)));
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE render_jobs SET status = 'failed', error = 'Stopped by user.', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, id, ownerId),
    env.DB.prepare(`UPDATE projects SET status = 'cancelled', updated_at = ? WHERE render_job_id = ? AND owner_id = ? AND status != 'completed'`).bind(now, id, ownerId),
  ]);
  return NextResponse.json({ ok: true });
}
