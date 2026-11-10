/* Test-only stand-in for next/headers, mirroring
   tests/scene-queue/shim-headers.ts — except the request headers are
   mutable, so each case can present a session cookie and/or forged
   identity headers. The test sets globalThis.__testHeaders before each
   call that reads headers(). */
export async function cookies() { return { get: () => undefined, set: () => undefined }; }
export async function headers() { return (globalThis as unknown as { __testHeaders?: Headers }).__testHeaders ?? new Headers(); }
export function redirect() { throw new Error("redirect() is not available in tests"); }
