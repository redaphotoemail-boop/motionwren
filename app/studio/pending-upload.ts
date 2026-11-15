/* A film's photos, kept on the device until the studio has confirmed every one. If the page is closed, frozen or the
   connection drops part-way, the photos are still here and "Send again" can finish the job without choosing them again.
   Best effort: if the browser blocks storage the film still sends, it just can't be resumed. */

export type PendingUpload = { jobId: string; tab: string; body: Record<string, unknown>; photos: Blob[]; at: number };

const NAME = "mw-pending-uploads";
const STORE = "uploads";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "jobId" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { resolve(null); db.close(); };
    });
  } catch { return null; }
}

export async function savePending(pending: PendingUpload) { await run("readwrite", (store) => store.put(pending)); }
export async function clearPending(jobId: string) { await run("readwrite", (store) => store.delete(jobId)); }
/** The newest film whose photos were not all confirmed (anything older than a day is dropped). */
export async function loadPending(): Promise<PendingUpload | null> {
  const all = await run<PendingUpload[]>("readonly", (store) => store.getAll());
  const fresh = (all || []).filter((item) => Date.now() - item.at < 24 * 3600 * 1000).sort((a, b) => b.at - a.at);
  for (const old of (all || []).filter((item) => !fresh.includes(item))) await clearPending(old.jobId);
  return fresh[0] || null;
}
