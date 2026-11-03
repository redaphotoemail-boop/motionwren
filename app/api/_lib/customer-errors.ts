/**
 * What a customer is told when a video cannot be finished. Customers never
 * see provider wording, API details, URLs or credit balances — only a plain
 * message, with the reason kept for the manager (render_jobs.error and the
 * manager's Production page).
 */
export function customerSafeError(message: string): string {
  const stripped = message.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (/photos? did not finish sending|photo could not be sent/i.test(stripped)) return "Your photos did not finish uploading, so nothing was made. Please start the order again.";
  if (/took too long/i.test(stripped)) return "We couldn't finish this video in time. You won't be charged for it — please try again, or contact us and we'll make it for you.";
  return "We couldn't finish this video. You won't be charged for it — please try again, or contact us and we'll make it for you.";
}
