import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { cloudflareReport } from "../../_lib/cloudflare-usage";
import { dailyLimitDollars, readWatchdog } from "../../_lib/editor-machines";

/* Owner only: what Cloudflare has used this month, by category, with the bill so far. Read-only. */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const [report, watchdog, limit] = await Promise.all([cloudflareReport(env as never), readWatchdog(env as never), dailyLimitDollars(env as never)]);
    // The editing-machine watchdog's last sweep and spend check (shown under the Cloudflare numbers).
    return NextResponse.json({ ...report, watchdog: { ...watchdog, limitDollars: limit } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}
