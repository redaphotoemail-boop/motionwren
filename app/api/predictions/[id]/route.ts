import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jsonError, requireAdmin } from "../../_lib/account";

async function authorize() {
  const { env } = await import("cloudflare:workers");
  await requireAdmin(env);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { await authorize(); } catch (error) { return jsonError(error); }
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "The Replicate API token has not been connected yet." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return NextResponse.json({ error: "Invalid generation identifier." }, { status: 400 });
  const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) return NextResponse.json({ error: (data.detail as string) || "Unable to retrieve this generation." }, { status: response.status });
  return NextResponse.json({ id: data.id, status: data.status, output: data.output, error: data.error });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { await authorize(); } catch (error) { return jsonError(error); }
  const cookieStore = await cookies();
  const token = process.env.REPLICATE_API_TOKEN || cookieStore.get("wan_replicate_token")?.value;
  if (!token) return NextResponse.json({ error: "The Replicate API token has not been connected yet." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return NextResponse.json({ error: "Invalid generation identifier." }, { status: 400 });
  const response = await fetch(`https://api.replicate.com/v1/predictions/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) return NextResponse.json({ error: (data.detail as string) || "Unable to stop this generation." }, { status: response.status });
  return NextResponse.json({ id: data.id, status: data.status });
}
