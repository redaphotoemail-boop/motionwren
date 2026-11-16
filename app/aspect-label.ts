/* One plain wording for a film's frame size, used on every History / production card
   (Studio History, client dashboard, admin project page, in-production cards).
   "Original" means the film was made at the shape of its photos — the ratio is shown
   when it is known. An unknown value is shown as-is, never silently relabelled 16:9. */

export type AspectKey = "horizontal" | "vertical" | "cinematic" | "original";

const RATIO_NAMES: Array<[number, string]> = [
  [1, "1:1"],
  [4 / 3, "4:3"],
  [3 / 2, "3:2"],
  [16 / 9, "16:9"],
  [9 / 16, "9:16"],
  [2.39, "2.39:1"],
];

function ratioName(ratio: number): string {
  for (const [value, name] of RATIO_NAMES) if (Math.abs(ratio - value) < 0.05) return name;
  return `${ratio.toFixed(2)}:1`;
}

export function aspectLabel(aspect: string | null | undefined, frameRatio?: number | null): string {
  if (aspect === "vertical") return "9:16";
  if (aspect === "horizontal") return "16:9";
  if (aspect === "cinematic") return "2.39:1";
  if (aspect === "original") return frameRatio ? `Original · ${ratioName(frameRatio)}` : "Original";
  return aspect || "—";
}

/** The frame-ratio wording for a film made at its photos' own shape, e.g. "3:2". */
export function frameRatioLabel(frameRatio: number | null | undefined): string {
  return frameRatio ? ratioName(frameRatio) : "Original";
}
