/* Small Stripe helpers (form-encoded REST, no SDK). The secret key is
   server-only (STRIPE_SECRET_KEY); nothing here runs without it. */

export function stripeSecret(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

export async function stripeRequest<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, values?: URLSearchParams, idempotencyKey?: string): Promise<{ ok: boolean; status: number; data: T & { error?: { message?: string } } }> {
  const secret = stripeSecret();
  if (!secret) return { ok: false, status: 503, data: { error: { message: "Billing is not connected yet." } } as T & { error?: { message?: string } } };
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  if (values) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: values ? values.toString() : undefined });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  return { ok: response.ok, status: response.status, data };
}

/* Ends a customer's Pro subscriptions right away (used when they delete
   their account, so a deleted account is never billed again). */
export async function cancelSubscriptions(subscriptionIds: string[]): Promise<void> {
  for (const id of subscriptionIds) {
    if (!/^sub_[A-Za-z0-9]+$/.test(id)) continue;
    const result = await stripeRequest("DELETE", `subscriptions/${id}`);
    if (!result.ok && result.status !== 404) console.error("[billing] could not cancel subscription", id, result.data.error?.message);
  }
}
