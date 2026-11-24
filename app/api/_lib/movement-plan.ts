/* Chooses each photo's camera movement: the scene first, then the story.
   Pure: numbers in, a movement per photo out. It never builds or edits a
   prompt; the move keys below only pick one of the fixed movement phrases
   already used for customer films (customer-production.ts MOVEMENTS).

   Step 1, the scene: every move gets a score from what the photo is like
   (OpenCV measures from composer/movement.py; the AI reader adds its own
   leaning when that option is on).
   Step 2, the story: the film opens by moving in, closes by pulling back,
   never repeats the same move twice in a row, and spreads the moves out. */

export type Move = "push" | "slideRight" | "pull" | "slideLeft" | "rise" | "drop";
export const MOVES: Move[] = ["push", "slideRight", "pull", "slideLeft", "rise", "drop"];

/** The numbers measured for one photo (see composer/movement.py). */
export type Measure = {
  aspect?: number;
  vanishing?: { x: number; y: number } | null;
  convergence?: number;
  levelShare?: number;
  uprightShare?: number;
  edgeDensity?: number;
  brightness?: number;
  skyRatio?: number;
  greenRatio?: number;
  centreWeight?: number;
  floorOpen?: number;
  error?: string;
};

/** What the AI reader said about one photo (optional). */
export type Reading = { room?: string; move?: Move; alt?: Move; why?: string };

export type Pick = { move: Move; why: string };
export type MovementMode = "off" | "opencv" | "ai";

const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Step 1: how well each move suits one photo (higher is better). */
export function scoreMoves(measure: Measure | null | undefined, reading?: Reading): Record<Move, number> & { reasons: Record<Move, string> } {
  const m = measure && !measure.error ? measure : {};
  const convergence = clamp(num(m.convergence));
  const level = clamp(num(m.levelShare));
  const upright = clamp(num(m.uprightShare));
  const sky = clamp(num(m.skyRatio));
  const green = clamp(num(m.greenRatio));
  const centre = clamp(num(m.centreWeight));
  const open = clamp(num(m.floorOpen));
  const aspect = num(m.aspect, 1.5);
  const tall = clamp((1.1 - aspect) / 0.5); // a portrait photo: 1 when very tall
  const wide = clamp((aspect - 1.45) / 0.5);
  const exterior = clamp(sky * 2.2 + green * 0.8);
  const vx = m.vanishing?.x ?? 0.5;

  const score: Record<Move, number> = {
    // Lines that meet in one place invite moving into the picture.
    push: 1 + convergence * 3 + open * 0.8 + centre * 0.6 + exterior * 0.4,
    // Pulling back suits wide establishing views: a house front, a big open room.
    pull: 0.9 + exterior * 1.4 + wide * 0.6 + open * 0.5 + (1 - convergence) * 0.3,
    // A flat view (walls and furniture across the frame) is shown by sliding along it.
    slideRight: 0.8 + (1 - convergence) * 2.0 + level * 1.0 + wide * 0.4 + (vx >= 0.5 ? 0.15 : 0),
    slideLeft: 0.8 + (1 - convergence) * 2.0 + level * 1.0 + wide * 0.4 + (vx < 0.5 ? 0.15 : 0),
    // Tall things (a facade, a staircase, tall windows) are shown by rising.
    rise: 0.5 + upright * 1.6 + tall * 1.6 + sky * 0.8,
    // Looking down onto a lawn, a pool or a table is a gentler, rarer reveal.
    drop: 0.2 + green * 1.0 + (exterior > 0.5 ? 0.3 : 0) + tall * 0.3,
  };

  const reasons: Record<Move, string> = {
    push: convergence > 0.45 ? "the room draws the eye inwards" : "a gentle way in",
    pull: exterior > 0.5 ? "a wide outside view" : "shows how the space sits together",
    slideRight: level > 0.5 ? "flat walls across the frame" : "shows the room along its width",
    slideLeft: level > 0.5 ? "flat walls across the frame" : "shows the room along its width",
    rise: tall > 0.4 || upright > 0.5 ? "tall lines worth following" : "lifts the view",
    drop: green > 0.3 ? "a garden or outdoor space below" : "a soft downward reveal",
  };

  // The AI reader's own leaning (it looked at the scene itself) counts strongly.
  if (reading?.move && MOVES.includes(reading.move)) score[reading.move] += 4.5;
  if (reading?.alt && MOVES.includes(reading.alt)) score[reading.alt] += 1.2;
  if (reading?.why && reading.move) reasons[reading.move] = String(reading.why).slice(0, 90);

  return Object.assign(score, { reasons });
}

const isSlide = (move: Move) => move === "slideLeft" || move === "slideRight";

/** Step 2: the story. Picks one move per photo, in the film's order. */
export function planSequence(measures: (Measure | null | undefined)[], readings: (Reading | undefined)[] = []): Pick[] {
  const count = measures.length;
  const scored = measures.map((measure, index) => scoreMoves(measure, readings[index]));
  const used: Record<Move, number> = { push: 0, slideRight: 0, pull: 0, slideLeft: 0, rise: 0, drop: 0 };
  const picks: Pick[] = [];
  const cap = Math.max(2, Math.ceil(count / 2.5)); // no move carries more than about 40% of the film
  for (let index = 0; index < count; index += 1) {
    const previous = picks[index - 1]?.move;
    const beforeThat = picks[index - 2]?.move;
    let best: Move = "push"; let bestScore = -Infinity;
    for (const move of MOVES) {
      let value = scored[index][move];
      if (index === 0 && count > 1) value += move === "push" ? 4 : move === "pull" ? -1.5 : 0; // open by moving in
      if (index === count - 1 && count > 1) value += move === "pull" ? 4 : move === "push" ? -0.8 : 0; // close by pulling back
      if (previous === move) value -= 6; // never the same move twice in a row
      else if (previous && isSlide(previous) && isSlide(move)) value -= 1.4; // two slides in a row feel the same
      if (beforeThat === move) value -= 0.8;
      if (used[move] >= cap) value -= 2.5; // spread the moves out
      if (move === "drop" && index === 0) value -= 2; // the opener should never start by looking down
      if (value > bestScore) { bestScore = value; best = move; }
    }
    used[best] += 1;
    const why = index === 0 && best === "push" ? "an opening move into the home" : index === count - 1 && best === "pull" ? "a closing pull-back" : scored[index].reasons[best];
    picks.push({ move: best, why });
  }
  return picks;
}

/** The fixed movement phrases (the exact words customer films already use). */
export const MOVE_PHRASE: Record<Move, string> = {
  push: "a slow stabilized push-in",
  slideRight: "a slow stabilized lateral slide from left to right",
  pull: "a slow stabilized pull-back",
  slideLeft: "a slow stabilized lateral slide from right to left",
  rise: "a subtle stabilized upward reveal",
  drop: "a subtle stabilized downward reveal",
};

/** What the film did before smart movement existed: the fixed cycle. */
export const CYCLE: Move[] = ["push", "slideRight", "pull", "slideLeft", "rise", "drop"];
export const cyclePicks = (count: number): Pick[] => Array.from({ length: count }, (_, index) => ({ move: CYCLE[index % CYCLE.length], why: "standard order" }));

export const MOVE_NAME: Record<Move, string> = { push: "Push in", pull: "Pull back", slideRight: "Slide right", slideLeft: "Slide left", rise: "Rise", drop: "Lower" };

export function readMode(value: unknown): MovementMode {
  return value === "off" || value === "ai" ? value : "opencv";
}
