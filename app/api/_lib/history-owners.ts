import { getGoogleSession, type AccountEnv } from "./account";

/**
 * Account ids whose saved videos the current visitor may list, play and
 * download: the signed-in session (Google or email) only. The old
 * fm_history_id cookie is no longer accepted: it was unsigned, so anyone
 * could set it to another account's id (email accounts have guessable ids)
 * and download their videos. Caller-supplied identity headers are never
 * accepted either (see the removed app/chatgpt-auth.ts).
 */
export async function historyOwnerIds(env: AccountEnv): Promise<string[]> {
  let sessionId: string | null = null;
  try {
    sessionId = (await getGoogleSession(env))?.id || null;
  } catch {
    sessionId = null;
  }
  return sessionId ? [sessionId] : [];
}

/**
 * A Workers stream R2 can store without buffering the whole upload, when the
 * runtime provides FixedLengthStream; otherwise (local development) the bytes.
 */
type FixedLengthStreamCtor = new (length: number) => { readable: ReadableStream; writable: WritableStream };
export async function uploadBody(request: Request, size: number): Promise<ReadableStream | ArrayBuffer> {
  const Fixed = (globalThis as unknown as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
  if (Fixed && request.body) {
    const { readable, writable } = new Fixed(size);
    void request.body.pipeTo(writable).catch(() => undefined);
    return readable;
  }
  return request.arrayBuffer();
}
