import type { StudioEngineKey } from "./engine-catalog";

/* Where the film's re-makes go: the second try stays on the same engine, the third tries another engine, the fourth Wan 3.0
   (the engine that has worked best). Runway is never used. */
export function fixEngine(first: StudioEngineKey, round: number): StudioEngineKey {
  if (round <= 1) return first;
  if (round >= 3) return "wan3";
  return first === "wan3" ? "h3" : first === "h3" ? "wan3" : first === "h3lite" ? "h3" : "h3";
}

/* Keeping re-make spending down. The quality check re-makes a flagged scene on its own, but each re-make costs
   engine money, so it is limited:
   · at most ONE automatic re-make per film (the owner can still re-make a scene by hand in History → Quality);
   · when more than half of a film's scenes are flagged the reviewer is being picky rather than the film being bad:
     the film is delivered and the owner is alerted instead of paying to make most of it again. */
export const AUTO_FIX_ROUNDS = 1;
export function autoRemake(input: { round: number; flagged: number; total: number; enabled: boolean }): { go: boolean; why: string } {
  if (!input.enabled) return { go: false, why: "off" };
  if (input.flagged < 1) return { go: false, why: "nothing flagged" };
  if (input.round >= AUTO_FIX_ROUNDS) return { go: false, why: "limit" };
  if (input.total >= 3 && input.flagged * 2 > input.total) return { go: false, why: "too many" };
  return { go: true, why: "" };
}
