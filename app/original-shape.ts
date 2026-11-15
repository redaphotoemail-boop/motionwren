/* "Original photo shape": the film is made at the shape of the photos themselves (3:2, 4:3…), so nothing is cut off before
   the engine sees it. Later the film can be cut to 16:9 or vertical without making it again. */

/** The shapes cameras and phones really produce. A photo within a hair of one of these is treated as exactly that shape. */
const COMMON_SHAPES = [1, 5 / 4, 4 / 3, 3 / 2, 16 / 9, 4 / 5, 3 / 4, 2 / 3, 9 / 16];
/** Kling takes shapes between 1:2.5 and 2.5:1; stay inside that for every engine. */
const MIN_SHAPE = 0.5;
const MAX_SHAPE = 2.5;

/** The film's one shape: the most common shape among the photos (the first photo's on a tie). Width ÷ height. */
export function filmShape(ratios: number[]): number {
  const clean = ratios.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return 16 / 9;
  const snapped = clean.map((value) => {
    const near = COMMON_SHAPES.find((shape) => Math.abs(value / shape - 1) < 0.015);
    return Math.min(MAX_SHAPE, Math.max(MIN_SHAPE, near ?? Math.round(value * 100) / 100));
  });
  const counts = new Map<number, number>();
  for (const value of snapped) counts.set(value, (counts.get(value) || 0) + 1);
  let best = snapped[0];
  for (const [value, count] of counts) if (count > (counts.get(best) || 0)) best = value;
  return Math.round(best * 10_000) / 10_000;
}

/** A shape sent by the browser, checked on the server: a number in range, or null. */
export function cleanShape(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= MIN_SHAPE && number <= MAX_SHAPE ? Math.round(number * 10_000) / 10_000 : null;
}

/** Even pixel sizes for a film of this shape and height (video needs even sizes). */
export function shapeSize(ratio: number, height: number) {
  const tall = Math.max(2, Math.round(height / 2) * 2);
  return { width: Math.max(2, Math.round((tall * ratio) / 2) * 2), height: tall };
}

/** A short name for a shape: "3:2", "4:3", or the decimal when it is none of the common ones. */
export function shapeLabel(ratio: number): string {
  const names: [number, string][] = [[1, "1:1"], [5 / 4, "5:4"], [4 / 3, "4:3"], [3 / 2, "3:2"], [16 / 9, "16:9"], [4 / 5, "4:5"], [3 / 4, "3:4"], [2 / 3, "2:3"], [9 / 16, "9:16"]];
  const hit = names.find(([shape]) => Math.abs(ratio / shape - 1) < 0.015);
  return hit ? hit[1] : `${ratio.toFixed(2)}:1`;
}
