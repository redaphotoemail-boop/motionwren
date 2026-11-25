import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { cloudflareReport } from "../../_lib/cloudflare-usage";

/* Owner only: what Cloudflare has used this month, by category, with the bill so far. Read-only. */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    return NextResponse.json(await cloudflareReport(env as never), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
