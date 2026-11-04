import { HttpError, enforceRateLimit, jsonError, requireAccount } from "../../../_lib/account";
import { customerSafeError } from "../../../_lib/customer-errors";
import { holdForApproval, loadOrder, needsApproval, startOrder } from "../../../_lib/customer-production";

/* A customer starts production of their submitted order. While payments
   are not connected, the order waits for the manager's OK instead
   (customer-production.ts); the manager starts it from the order page. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await context.params;
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    await enforceRateLimit(env, account.id, "project-generate", 6, 60 * 60 * 1000);
    const providerToken = process.env.REPLICATE_API_TOKEN;
    if (!providerToken) return Response.json({ error: "Automatic production is not connected yet. The project remains safely submitted for owner production." }, { status: 503 });
    const project = await loadOrder(env, projectId, account.id);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    if (project.status === "approval") return Response.json({ status: "approval" }, { status: 202 });
    if (["submitted", "failed"].includes(project.status) && await needsApproval(env, account.role)) return Response.json(await holdForApproval(env, project, account.id), { status: 202 });
    const result = await startOrder(env, project, account.id, new URL(request.url).origin, providerToken);
    return Response.json(result, { status: "resumed" in result ? 200 : 202 });
  } catch (error) {
    // Account and permission errors are shown as-is; anything else in plain words.
    return error instanceof HttpError ? jsonError(error) : Response.json({ error: customerSafeError(error instanceof Error ? error.message : "") }, { status: 500 });
  }
}
