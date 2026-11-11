import { audit, enforceRateLimit, jsonError, requireAccount } from "../_lib/account";
import { redeemGiftCode } from "../_lib/gift-codes";

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAccount(env);
    await enforceRateLimit(env, account.id, "redeem", 10, 15 * 60 * 1000); // guessing codes is slow
    const body = await request.json().catch(() => ({})) as { code?: unknown };
    const credits = await redeemGiftCode(env, account.id, body.code);
    await audit(env, account.id, "gift.redeemed", "gift_code", undefined, { credits });
    return Response.json({ credits, message: credits === 1 ? "1 free video added to your account." : `${credits} free videos added to your account.` });
  } catch (error) { return jsonError(error); }
}
