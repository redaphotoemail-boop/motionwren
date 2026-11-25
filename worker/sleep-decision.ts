/* When the watchdog knocks on an editing machine (worker/composer.ts), whether the machine stops.
   Pure, so it is tested on its own (tests/editor-machines.test.mjs). */

export const MIN_IDLE_MS = 30 * 60 * 1000;
export const STUCK_AFTER_MS = 30 * 60 * 1000;

export type SleepInput = {
  running: boolean;
  /** Last time a request reached the machine (0 = no record). */
  lastUse: number;
  /** Last request in this instance's lifetime, for the unfinished-reply rule. */
  lastRequestAt: number;
  /** Replies still being sent. */
  inflight: number;
  /** How long it must have been idle, as asked by the watchdog (never under MIN_IDLE_MS). */
  idleMs: number;
  now: number;
};

export function sleepDecision(input: SleepInput): { stop: boolean; reason: "asleep" | "in use" | "replying" | "idle" } {
  if (!input.running) return { stop: false, reason: "asleep" };
  const idle = Math.max(MIN_IDLE_MS, Number(input.idleMs) || 0);
  if (input.lastUse && input.now - input.lastUse < idle) return { stop: false, reason: "in use" };
  if (input.inflight > 0 && input.now - input.lastRequestAt < STUCK_AFTER_MS) return { stop: false, reason: "replying" };
  return { stop: true, reason: "idle" };
}
