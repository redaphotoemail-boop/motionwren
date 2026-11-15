/* What this phone did while a film's photos were being sent. The server can only say how many photos arrived; this says
   what the page saw (how long each photo took, whether the page was in the background), kept on the device so a stopped
   film can show facts instead of a guess. */

export type SendEvent = { scene: number; attempt: number; bytes: number; ms: number; outcome: "ok" | "timeout" | "dropped" | "refused"; detail?: string };
export type SendLog = { startedAt: number; sizes: number[]; hiddenMs: number; hiddenTimes: number; events: SendEvent[]; sent: number; finishedAt?: number };

const key = (id: string) => `mw-send-${id}`;

export function saveSendLog(id: string, log: SendLog) {
  try {
    localStorage.setItem(key(id), JSON.stringify(log));
    const keys = Object.keys(localStorage).filter((name) => name.startsWith("mw-send-"));
    if (keys.length > 12) keys.sort().slice(0, keys.length - 12).forEach((name) => localStorage.removeItem(name));
  } catch { /* storage can be blocked: the film still sends */ }
}
export function loadSendLog(id: string): SendLog | null {
  try { const raw = localStorage.getItem(key(id)); return raw ? JSON.parse(raw) as SendLog : null; } catch { return null; }
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const seconds = (ms: number) => ms >= 90_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`;

/** The cause this phone can support with facts (or says it has none), the facts behind it, and what to do. */
export function explainSend(log: SendLog | null, total: number): { verdict: string; facts: string[]; advice: string } {
  if (!log) return { verdict: "This phone has no record of sending these photos.", facts: [], advice: "The film may have been started on another device, or the page was closed before sending began. Start it again from the Studio and keep the page open until it says Photos received." };
  const facts = [
    `${log.sent} of ${total} photos reported sent from this phone`,
    `Photos total ${mb(log.sizes.reduce((sum, size) => sum + size, 0))}${log.sizes.length ? `, largest ${mb(Math.max(...log.sizes))}` : ""}`,
    `${log.events.length} send attempt${log.events.length === 1 ? "" : "s"} recorded`,
    ...(log.hiddenMs > 1000 ? [`The page was out of view for ${seconds(log.hiddenMs)} while sending (${log.hiddenTimes} time${log.hiddenTimes === 1 ? "" : "s"})`] : []),
  ];
  const slow = log.events.find((event) => event.outcome === "timeout");
  const refused = log.events.find((event) => event.outcome === "refused");
  if (log.hiddenMs >= 15_000) return { verdict: `The page was out of view for ${seconds(log.hiddenMs)} while the photos were sending. Switching apps or locking the screen pauses an upload.`, facts, advice: "Keep Studio open with the screen on until it says Photos received." };
  if (refused) return { verdict: `The server refused photo ${refused.scene}${refused.detail ? `: ${refused.detail}` : "."}`, facts, advice: "Start the film again. If it repeats, the photo may be damaged: try another." };
  if (slow) return { verdict: `Photo ${slow.scene} (${mb(slow.bytes)}) did not finish within 2 minutes on this connection.`, facts, advice: "Use Wi-Fi or a stronger signal, then start again." };
  if (!log.events.length) return { verdict: "Sending never started: the page stopped right after the film was created.", facts, advice: "This happens when the page is closed or frozen at that moment. Start again and keep Studio open." };
  if (log.sent < total) return { verdict: "The connection dropped while the photos were sending.", facts, advice: "Start again on a steadier connection." };
  return { verdict: "This phone reported every photo as sent, but the server did not receive all of them.", facts, advice: "Start again. If it repeats, tell me the video number so I can check the server." };
}
