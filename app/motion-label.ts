/* Names the camera movement a video was asked for, from its stored prompt.
   Read-only: it matches the preset wording, it never changes a prompt. */
const RULES: Array<[RegExp, string]> = [
  [/walkthrough/i, "Walkthrough"],
  [/tilts? (slowly )?upward|starts low/i, "Tilt up"],
  [/push-in/i, "Slow push-in"],
  [/lateral slide|horizontal lateral/i, "Lateral slide"],
  [/orbit/i, "Subtle orbit"],
  [/focus shift|focus shifts/i, "Focus shift"],
  [/pull-?back|pulls back/i, "Slow pull-back"],
  [/selects and combines|choose and combine/i, "AI mixed movement"],
];
export function motionLabel(prompt: string | null | undefined): string {
  const text = String(prompt || "");
  for (const [pattern, label] of RULES) if (pattern.test(text)) return label;
  return "";
}
