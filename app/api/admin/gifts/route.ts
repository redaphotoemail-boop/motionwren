import { audit, jsonError, requireAdmin } from "../../_lib/account";
import { createGiftCodes, listGiftCodes } from "../../_lib/gift-codes";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    return Response.json({ codes: await listGiftCodes(env) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const admin = await requireAdmin(env);
    const body = await request.json() as { credits?: unknown; count?: unknown; note?: unknown };
    const credits = Number(body.credits), count = Number(body.count || 1);
    const codes = await createGiftCodes(env, admin.id, credits, count, String(body.note || "").trim());
    await audit(env, admin.id, "gift.created", "gift_code", codes[0], { credits, count });
    return Response.json({ codes, credits });
  } catch (error) { return jsonError(error); }
}
