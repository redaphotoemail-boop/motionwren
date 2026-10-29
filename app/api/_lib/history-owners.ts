import { cookies, headers } from "next/headers";
import { getGoogleSession, type AccountEnv } from "./account";

export const HISTORY_COOKIE = "fm_history_id";

/**
 * Account ids whose saved videos the current visitor may list, play and
 * download: the signed-in session (Google or email) plus the two older
 * identities these routes always accepted. The session was missing, so a
 * customer signed in on motionwren.com got "Video not found" when pressing
 * Download, and the owner's Studio history came back empty.
 */
export async function historyOwnerIds(env: AccountEnv): Promise<string[]> {
  let sessionId: string | null = null;
  try {
    sessionId = (await getGoogleSession(env))?.id || null;
  } catch {
    sessionId = null;
  }
  const authenticatedId = (await headers()).get("oai-authenticated-user-id");
  const legacyId = (await cookies()).get(HISTORY_COOKIE)?.value;
  return [...new Set([sessionId, authenticatedId, legacyId].filter((value): value is string => Boolean(value)))];
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
