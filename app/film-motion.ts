/* Camera moves for a film made into a template. Push-in matters most, orbits come second and slides third;
   a pull-back only comes near the end, where it reads as the film stepping back. Focus shifts are never used here
   (they do not survive the template's fast cuts). Pure, so it can be tested on its own. */
export type TemplateMove = "push" | "orbit" | "slide" | "pull";

const CYCLE: TemplateMove[] = ["push", "orbit", "push", "slide"];

export function templateMotions(count: number): TemplateMove[] {
  const total = Math.max(0, Math.floor(count) || 0);
  const moves = Array.from({ length: total }, (_, index) => CYCLE[index % CYCLE.length]);
  if (total >= 4) moves[total - 1] = "pull";
  return moves;
}
