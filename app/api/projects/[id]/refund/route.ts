import { enforceRateLimit, jsonError, requireAccount } from "../../../_lib/account";
import { refundHoldingOrder } from "../../../_lib/render-jobs";

/* A customer asks for their credit back on an order that is taking longer:
   the automatic retries are used up and the fix did not land quickly. The
   refund is the fallback, not the first thing shown — the dashboard only
   offers it on a holding order, and only when a credit was reserved for it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await context.params;
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    await enforceRateLimit(env, account.id, "project-refund", 3, 60 * 60 * 1000);
    const result = await refundHoldingOrder(env, projectId, account.id);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
