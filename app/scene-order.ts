/* The client's film editor (Reda, Nov 25 2026): scene order and kept takes. Kept apart from render-jobs.ts so it can be tested on its own. */

/** Earlier versions kept per scene (the oldest goes when a scene has more). */
export const MAX_TAKES = 6;
/** Where an earlier version of a scene is stored, next to the film's scenes. */
export const takeFile = (scene: number, take: number) => `take-${String(scene + 1).padStart(2, "0")}-${take + 1}.mp4`;

/** The scene order as a full list, or null when it is the order the film was made in (or not valid for this film). */
export function sceneOrder(order: unknown, count: number): number[] | null {
  if (!Array.isArray(order) || order.length !== count) return null;
  const list = order.map(Number);
  if (!list.every((value) => Number.isInteger(value) && value >= 0 && value < count) || new Set(list).size !== count) return null;
  return list.some((value, index) => value !== index) ? list : null;
}
