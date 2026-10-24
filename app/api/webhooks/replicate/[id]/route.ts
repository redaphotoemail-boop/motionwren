import { NextResponse } from "next/server";
import { advanceRenderJob, getRenderJob } from "../../../_lib/render-jobs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supplied = new URL(request.url).searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || supplied.length < 48) return NextResponse.json({ error: "Invalid callback." }, { status: 400 });
  const providerToken = process.env.REPLICATE_API_TOKEN;
  if (!providerToken) return NextResponse.json({ error: "Generation provider is not configured." }, { status: 503 });
  const { env } = await import("cloudflare:workers");
  const row = await getRenderJob(env, id);
  if (!row || !row.webhookToken || row.webhookToken !== supplied) return NextResponse.json({ error: "Callback authorization failed." }, { status: 403 });
  if (["succeeded", "failed"].includes(row.status)) return NextResponse.json({ ok: true, terminal: true });
  const webhook = `${new URL(request.url).origin}/api/webhooks/replicate/${id}?token=${row.webhookToken}`;
  await advanceRenderJob(env, row, providerToken, webhook);
  return NextResponse.json({ ok: true });
}
