/* The once-a-minute server heartbeat (a Cloudflare scheduled event, see
   worker/index.ts) moves along every video in production, so no video ever
   depends on a provider callback arriving or on someone having a page open.
   The scheduled handler calls /api/heartbeat inside the Worker with this key,
   derived from the server's engine key, which no browser ever sees. */
export async function heartbeatKey(secret: string) {
  const bytes = new TextEncoder().encode(`${secret}:motionwren-heartbeat`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
