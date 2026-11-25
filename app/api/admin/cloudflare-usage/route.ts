import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { cloudflareReport } from "../../_lib/cloudflare-usage";
import { readBill } from "../../_lib/cloudflare-bill-read";
import { dailyLimitDollars, readWatchdog } from "../../_lib/editor-machines";

/* Owner only: what Cloudflare is billing this period (by Cloudflare product and by MotionWren feature), the usage
   behind it, and the editing-machine watchdog. Read-only. */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const [report, bill, watchdog, limit] = await Promise.all([
      cloudflareReport(env as never),
      readBill(env as never).catch((error) => ({ connected: true as const, error: String(error instanceof Error ? error.message : error).slice(0, 160) })),
      readWatchdog(env as never),
      dailyLimitDollars(env as never),
    ]);
    return NextResponse.json({ ...report, bill, watchdog: { ...watchdog, limitDollars: limit } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
