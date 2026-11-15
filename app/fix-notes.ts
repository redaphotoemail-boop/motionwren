/* The instruction written for a scene that is made again to fix a problem. It names every problem the check found for that
   scene, says how to avoid each one, and repeats the standing camera-only rules, so the new attempt is told everything.
   It is ADDED after the scene's own prompt; the scene's own prompt is never changed. Pure: no server code, so it can be tested. */

const VEHICLE = /\b(car|cars|vehicle|vehicles|truck|suv|van|automobile|driveway)\b/i;
const LINES = /\b(line|lines|wavy|distort|warp|bend|bent|curv|straight)\w*/i;
const ADDED = /\b(added|new window|expanded|extra|square|appeared|invented)\b/i;
const REMOVED = /\b(missing|removed|disappear|gone|vanish)\w*/i;
const SMEAR = /\b(smear|smeared|haze|hazy|blur|blurry|patch|patches|melt|melting)\w*/i;
const TEXT = /\b(watermark|logo|text|caption|letters)\b/i;
const JUMP = /\b(jump|cut|flicker|flash)\w*/i;
const BLACK = /\b(black|dark frame|blank)\w*/i;

const CLAUSES: { test: RegExp; text: string }[] = [
  { test: VEHICLE, text: "Every car and vehicle is parked exactly where it is in the photo and stays perfectly still: no rolling, turning, driving, reversing, headlights or brake lights switching on, and no doors opening. Only the camera moves." },
  { test: LINES, text: "Keep every straight line straight: walls, door and window frames, ceiling lines, floor edges and the horizon stay perfectly vertical and horizontal, with no wobble, bending or warping." },
  { test: ADDED, text: "Add nothing that is not in the photo: no new furniture, windows, doors, panelling, objects or people, and do not enlarge or extend the room." },
  { test: REMOVED, text: "Remove nothing: every object, piece of furniture and fixture in the photo stays visible where the photo has it for the whole clip." },
  { test: SMEAR, text: "Keep every surface sharp and clean from the first frame to the last: no smearing, haze, melting or blurred patches, including on trees, foliage, glass and reflections." },
  { test: TEXT, text: "Show no text, logo or watermark anywhere; the picture contains only what the photo contains." },
  { test: JUMP, text: "One continuous, smooth camera movement from the first frame to the last, with no cuts, jumps or flicker." },
  { test: BLACK, text: "The picture stays fully lit and visible from the first frame to the last, with no black or blank frames." },
];

/* Always repeated: the real-estate rule that only the camera moves. */
export const STANDING_RULES = "Only the camera moves. The architecture, furnishings, lighting, reflections, cars and everything outside the windows stay exactly as in the photo and perfectly still. Water, flames, curtains and trees do not start to move unless the photo shows them moving. The first frame matches the photo exactly.";

export function fixInstruction(issues: string[], move?: string, extra = "") {
  const list = [...new Set(issues.map((text) => text.replace(/^Reality:\s*/i, "").replace(/[.\s]+$/, "").trim()).filter(Boolean))];
  const clauses = CLAUSES.filter((clause) => list.some((text) => clause.test.test(text))).map((clause) => clause.text);
  const head = list.length
    ? `Fix: the previous attempt of this scene had ${list.length === 1 ? "this problem" : "these problems"}: ${list.map((text) => `"${text}"`).join("; ")}. Make a new version that does not have ${list.length === 1 ? "it" : "any of them"}.`
    : "Fix: make a new, cleaner version of this scene.";
  const motion = move ? `Keep the camera move (${move}) smooth and steady.` : "";
  return [head, ...clauses, motion, STANDING_RULES, extra.trim()].filter(Boolean).join(" ");
}
