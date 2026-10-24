import { requireAccount, jsonError } from "../_lib/account";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    return Response.json({ account: await requireAccount(env), billingEnabled: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_SINGLE && process.env.STRIPE_PRICE_FIVE_PACK && process.env.STRIPE_PRICE_PRO) });
  } catch (error) {
    return jsonError(error);
  }
}
