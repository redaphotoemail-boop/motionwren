/* Studio Ads: start generation (draft or full). Admin only. No billing
   gate: this is the owner's own tool, and generation is on his Replicate
   bill — the same as the Studio lab. The estimate is shown before starting. */
import { HttpError, enforceRateLimit, jsonError, requireAdmin } from "../../../../_lib/account";
import { loadAd, startAd } from "../../../../_lib/ads-production";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: adId } = await context.params;
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    await enforceRateLimit(env, admin.id, "studio-ads-generate", 6, 60 * 60 * 1000);
    const providerToken = process.env.REPLICATE_API_TOKEN;
    if (!providerToken) return Response.json({ error: "Automatic production is not connected yet." }, { status: 503 });
    const ad = await loadAd(env, adId, admin.id);
    if (!ad) return Response.json({ error: "Ad not found." }, { status: 404 });
    const result = await startAd(env, ad, admin.id, new URL(request.url).origin, providerToken);
    return Response.json(result, { status: "resumed" in result ? 200 : 202 });
  } catch (error) {
    return error instanceof HttpError ? jsonError(error) : Response.json({ error: error instanceof Error ? error.message.slice(0, 500) : "Production could not start." }, { status: 500 });
  }
}
