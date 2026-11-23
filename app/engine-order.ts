import type { StudioEngineKey } from "./engine-catalog";

/* The engines, in the order MotionWren relies on them: Wan 3.0 first, then the backups in this order.
   When an engine cannot make a scene (it stalls, or cannot take it), the scenes still to be made go to the next one. */
export const ENGINE_ORDER: StudioEngineKey[] = ["wan3", "h3lite", "h3", "hailuo23"];

/* Where scenes go when the engine they are on stalls. `chosen` is the owner's "If a scene stalls, use" setting (null = Off).
   - Off never switches.
   - From Wan 3.0 (or any engine outside the order) the first backup is the owner's choice.
   - From a backup, the next engine in the order; after the last one there is nowhere further to go. */
export function stallBackup(current: StudioEngineKey, chosen: StudioEngineKey | null): StudioEngineKey | null {
  if (!chosen) return null;
  const at = ENGINE_ORDER.indexOf(current);
  if (at <= 0) return chosen === current ? null : chosen;
  return ENGINE_ORDER[at + 1] || null;
}
