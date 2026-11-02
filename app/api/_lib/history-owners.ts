import { getChatGPTUser } from "../../chatgpt-auth";
import { getGoogleSession, type AccountEnv } from "./account";

export const HISTORY_COOKIE = "fm_history_id";

/**
 * Account ids whose saved videos the current visitor may list, play and
 * download: the signed-in session (Google or email), plus the development
 * identity headers where they are trusted. The old fm_history_id cookie is no
 * longer accepted: it was unsigned, so anyone could set it to another
 * account's id (email accounts have guessable ids) and download their videos.
 */
export async function historyOwnerIds(env: AccountEnv): Promise<string[]> {
  let sessionId: string | null = null;
  try {
    sessionId = (await getGoogleSession(env))?.id || null;
  } catch {
    sessionId = null;
  }
  const headerId = (await getChatGPTUser())?.id || null;
  return [...new Set([sessionId, headerId].filter((value): value is string => Boolean(value)))];
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
