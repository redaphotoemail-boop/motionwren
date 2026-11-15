import type { StudioEngineKey } from "./engine-catalog";

/* Where the film's re-makes go: the second try stays on the same engine, the third tries another engine, the fourth Wan 3.0
   (the engine that has worked best). Runway is never used. */
export function fixEngine(first: StudioEngineKey, round: number): StudioEngineKey {
  if (round <= 1) return first;
  if (round >= 3) return "wan3";
  return first === "wan3" ? "h3" : first === "h3" ? "wan3" : first === "h3lite" ? "h3" : "h3";
}
