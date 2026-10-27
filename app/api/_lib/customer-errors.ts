/**
 * Customer-safe provider error text. Provider errors can embed raw URLs
 * (e.g. a billing page) that must never reach a customer notification,
 * email, or banner. Insufficient-credit errors get one plain message.
 */
export function customerSafeError(message: string): string {
  const stripped = message.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (/insufficient credit/i.test(stripped)) {
    return "Video generation is temporarily unavailable because the provider is out of credit. Please try again later.";
  }
  return stripped || "Video production could not be completed. Please try again later.";
}
