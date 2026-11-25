import { jsonError, requireAdmin } from "../../../_lib/account";
import { spendBreakdown } from "../../../_lib/spend-guard";
import { periodStarts } from "../../../../spend-guard";

/* Manager only: what is behind the Today and This month spending bars, by kind of cost, by who it was for, and film by
   film. Read-only. */
export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const period = new URL(request.url).searchParams.get("period") === "day" ? "day" : "month";
    const { dayStart, monthStart } = periodStarts();
    return Response.json({ period, since: period === "day" ? dayStart : monthStart, ...(await spendBreakdown(env, period === "day" ? dayStart : monthStart)) });
  } catch (error) { return jsonError(error); }
}
