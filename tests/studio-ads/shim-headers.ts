/* Test-only stand-ins for next/headers + next/navigation, mirroring
   tests/scene-queue/shim-headers.ts. Production code only calls these
   inside request handlers, never during startAd. */
export async function cookies() { return { get: () => undefined, set: () => undefined }; }
export async function headers() { return new Headers(); }
export function redirect() { throw new Error("redirect() is not available in tests"); }
