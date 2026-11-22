/* The social-media templates: thirteen short real-estate edits for Reels, TikTok, Shorts and YouTube. Each one is a
   recipe built from beat-aligned cut times (numbers only), plus what it asks of the photos, so Studio can say, before
   anything is made, what the best result needs, and check the uploads against it afterwards.
   Pure (no Worker bindings), so plain node can test it. The recipe maths must match composer/wrencut.mjs. */

import type { WrenRecipe } from "./wrencut";
import type { CameraMove, TextSlot } from "./template-contract";

export type Role = "exterior" | "aerial" | "entry" | "living" | "dining" | "kitchen" | "bedroom" | "bathroom" | "outdoor" | "detail" | "any";
export type Light = "day" | "dusk" | "night" | "any";

/* One photo the template asks for. Photos play in the order of the acts; a photo may fill several shots. */
export type Act = {
  role: Role; light: Light; label: string; hint: string;
  /** The template needs it (it is dropped last when fewer photos arrive). */
  essential?: boolean;
  /** What the camera does on this photo, in plain words. */
  move: string;
  /** The same move from the closed list (app/template-contract.ts): the fixed part of the recipe. */
  camera: CameraMove;
  /** The photo should show real depth: a hall, a room or a path the camera can travel into. */
  depth?: boolean;
};

type Join = "c" | "f" | `d${number}`;
type Ramp = { slot: number; in?: "entry" | "settle"; out?: boolean; peak?: number; slow?: number; mid?: boolean };

export type SocialSpec = {
  key: string; number: number; name: string;
  /** What the viewer gets, in plain words. */
  summary: string;
  frame: "vertical" | "horizontal" | "cinematic";
  canvas: "9:16" | "16:9" | "21:9" | "4:3";
  bpm?: number; music?: string;
  /** Beat-aligned cut times (seconds): the shots run between 0, each of these, and the end (the last number). */
  bounds: number[];
  /** The join between each pair of shots: c = hard cut, f = white flash, dN = crossfade of N seconds. */
  joins: Join[];
  /** Which photo (act) fills each shot. */
  use: number[];
  acts: Act[];
  ramps: Ramp[];
  /** Pairs of photos that must show the same view (day and night): [act, act]. */
  pairs?: [number, number][];
  grade?: { warmth: number; saturation: number };
  rules: string[]; avoid: string[];
  /** The words on screen: named slots at fixed places (drawn by Titles), each with an example. */
  text: TextSlot[];
  /** What this version does differently from the reference, said plainly. */
  approx: string[];
};

const GENERAL_RULES = ["All photos from the same property, shot the same day, with the same lens and colour.", "Keep verticals straight and the horizon level.", "Leave people, cars and clutter out of frame: the film moves only the camera."];
const GENERAL_AVOID = ["Photos with heavy filters or HDR halos.", "Phone screenshots or photos with borders and watermarks.", "Two near-identical photos of the same view."];

const cut: Join = "c";

export const SOCIAL_SPECS: SocialSpec[] = [
  {
    key: "grand-foyer", number: 2, name: "The Grand Foyer", summary: "A premium tour that opens on the entrance and keeps finding the next beautiful detail. Fast, elegant, on the beat.",
    frame: "vertical", canvas: "9:16", bpm: 120, music: "elegant modern classical, piano and strings, 120 BPM",
    bounds: [0, 2, 3, 6, 6.5, 7.5, 9, 9.5, 10, 11, 11.5, 12], joins: [cut, cut, cut, cut, cut, cut, cut, cut, cut, cut], use: [0, 1, 2, 3, 4, 1, 4, 4, 5, 4, 5],
    acts: [
      { role: "living", light: "any", label: "Living room", hint: "A wide view of the main living room.", move: "Slow push-in", camera: "push_in", depth: true },
      { role: "entry", light: "any", label: "Foyer", hint: "The entrance hall, with the ceiling and any staircase in view.", essential: true, move: "Rushes in, then slows to show the hall", camera: "whip_in_then_push_in", depth: true },
      { role: "any", light: "any", label: "Balcony or staircase", hint: "A balcony, landing or staircase, ideally with a chandelier or railing.", move: "Climbs, then slows on the detail", camera: "rise" },
      { role: "living", light: "dusk", label: "Living room at dusk", hint: "The same living room with lights on at dusk (if you have it).", move: "Short glide", camera: "glide" },
      { role: "kitchen", light: "any", label: "Kitchen", hint: "The kitchen, with the island and sink in view.", essential: true, move: "Whips in, then slows", camera: "whip_in_then_push_in", depth: true },
      { role: "dining", light: "any", label: "Dining room", hint: "Dining space with a chandelier or feature light.", move: "Slow push-in", camera: "push_in" },
    ],
    ramps: [{ slot: 1, in: "entry", peak: 3, slow: 0.3 }, { slot: 2, in: "entry", peak: 3, slow: 0.3 }, { slot: 6, in: "settle", peak: 3 }],
    grade: { warmth: 0.02, saturation: 1.08 },
    rules: GENERAL_RULES, avoid: GENERAL_AVOID,
    text: [{ at: "start", line: "title", field: "location", example: "Penthouse · Downtown" }, { at: "start", line: "sub", field: "headline", example: "A curved balcony overlooking the city" }, { at: "end", line: "title", field: "cta", example: "Book a viewing" }],
    approx: ["The lens-wave transitions of the reference are plain cuts here.", "The serif captions are not drawn by the template: add them in Titles."],
  },
  {
    key: "skylight-house", number: 3, name: "Skylight House", summary: "A light, gliding architectural tour with quick detail cuts and a drone finish.",
    frame: "vertical", canvas: "9:16", bpm: 136, music: "upbeat modern electronic, airy, light groove, 136 BPM",
    bounds: [0, 0.88, 1.32, 2.65, 5.74, 7.06, 8.82, 9.71, 10.15, 11.03, 11.91, 13.2], joins: [cut, cut, cut, cut, cut, cut, cut, cut, cut, cut], use: [0, 1, 2, 3, 4, 1, 4, 4, 3, 3, 5],
    acts: [
      { role: "entry", light: "any", label: "A skylit hallway", hint: "A hall or corridor with a skylight or a long view ahead.", essential: true, move: "Glides forward and speeds through", camera: "glide", depth: true },
      { role: "exterior", light: "day", label: "The house, daytime", hint: "The house from the street or garden in daylight.", essential: true, move: "Slow push", camera: "push_in" },
      { role: "exterior", light: "dusk", label: "The house at dusk", hint: "The same house at dusk with lights on.", move: "Slow push", camera: "push_in" },
      { role: "living", light: "any", label: "Living space", hint: "The main living area, wide, with some depth.", essential: true, move: "A long glide through the room", camera: "glide", depth: true },
      { role: "detail", light: "any", label: "A material detail", hint: "A wood wall, shelving or a striking finish, close.", move: "Slow slide", camera: "glide_lateral" },
      { role: "aerial", light: "day", label: "Aerial view", hint: "A drone photo of the house and its plot.", move: "Drifts slowly over the property", camera: "drift" },
    ],
    ramps: [{ slot: 0, in: "entry", peak: 3, slow: 0.35 }, { slot: 3, in: "settle", out: true, peak: 3.2 }, { slot: 10, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0.01, saturation: 1.1 },
    rules: GENERAL_RULES, avoid: GENERAL_AVOID,
    text: [{ at: "start", line: "title", field: "property", example: "Skylight House" }, { at: "end", line: "title", field: "price", example: "$0,000,000" }, { at: "end", line: "sub", field: "cta", example: "Book a viewing" }],
    approx: ["The Dutch-angle and tilted views of the reference are straight shots here, so your photos stay level.", "The price is not drawn by the template: add it in Titles."],
  },
  {
    key: "night-estate", number: 4, name: "Night Estate", summary: "A moody dusk estate: push into the house, one long interior glide, then aerial and pool reveals.",
    frame: "vertical", canvas: "9:16", bpm: 120, music: "moody cinematic, low strings and a soft pulse, 120 BPM",
    bounds: [0, 1.5, 7, 8, 9.5, 10], joins: [cut, cut, cut, cut], use: [0, 1, 2, 3, 4],
    acts: [
      { role: "exterior", light: "dusk", label: "The house at dusk", hint: "Front of the house at dusk with lights on.", essential: true, move: "Pushes in fast toward the door", camera: "push_in" },
      { role: "living", light: "any", label: "Inside: the main room", hint: "The main living space, lit, with depth.", essential: true, move: "Enters fast, then slows and glides", camera: "whip_in_then_push_in", depth: true },
      { role: "aerial", light: "dusk", label: "Aerial at dusk", hint: "A drone view of the property at dusk.", move: "Settles, then drifts", camera: "drift" },
      { role: "outdoor", light: "dusk", label: "Pool or terrace at dusk", hint: "The pool or terrace with the lights on.", essential: true, move: "Enters fast, then slows on the water", camera: "whip_in_then_push_in" },
      { role: "exterior", light: "dusk", label: "Garage or driveway", hint: "The garage, gate or driveway.", move: "Short push", camera: "push_in" },
    ],
    ramps: [{ slot: 0, out: true, peak: 3 }, { slot: 1, in: "entry", peak: 3.5, slow: 0.3 }, { slot: 2, in: "settle", peak: 2.5 }, { slot: 3, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0.03, saturation: 1.06 },
    rules: [...GENERAL_RULES, "Dusk or night photos work best with lit windows and lit pool water."],
    avoid: [...GENERAL_AVOID, "Midday sun: this template is a night mood."],
    text: [{ at: "start", line: "title", field: "property", example: "Night Estate" }, { at: "end", line: "title", field: "headline", example: "Private. Quiet. Yours." }],
    approx: ["The blur transition into the house is a fast push and a cut."],
  },
  {
    key: "white-sweep-villa", number: 5, name: "White Sweep Villa", summary: "A sunny villa tour from the pool to a drone pass, stitched with white sweeps.",
    frame: "vertical", canvas: "9:16", bpm: 100, music: "bright Mediterranean groove, light and sunny, 100 BPM",
    bounds: [0, 2.4, 4.2, 6, 7.8, 8.4, 9, 10.2, 10.8, 12], joins: [cut, cut, cut, "f", cut, cut, cut, cut], use: [0, 0, 1, 2, 3, 0, 4, 4, 5],
    acts: [
      { role: "outdoor", light: "day", label: "Pool and patio", hint: "The pool area, wide, with loungers.", essential: true, move: "Whips in, then slows", camera: "whip_in_then_push_in", depth: true },
      { role: "aerial", light: "day", label: "Aerial view", hint: "A drone view of the villa.", move: "Settles from a fast whip", camera: "whip_in_then_push_in" },
      { role: "exterior", light: "day", label: "The entrance", hint: "The front of the villa and its entrance.", essential: true, move: "Slow push", camera: "push_in" },
      { role: "living", light: "any", label: "Living room", hint: "Bright living room, ideally with a glass wall.", essential: true, move: "White sweep in, then slows", camera: "whip_in_then_push_in", depth: true },
      { role: "bathroom", light: "any", label: "Bathroom", hint: "A clean bathroom with the vanity in view.", move: "Slow slide", camera: "glide_lateral" },
      { role: "kitchen", light: "any", label: "Kitchen", hint: "The kitchen, from a doorway.", move: "Glide", camera: "glide" },
    ],
    ramps: [{ slot: 0, in: "entry", peak: 3.5, slow: 0.3 }, { slot: 1, out: true, peak: 3 }, { slot: 2, in: "settle", peak: 2.5 }, { slot: 3, out: true, peak: 2.8 }, { slot: 4, in: "settle", peak: 2.5 }],
    grade: { warmth: 0.05, saturation: 1.14 },
    rules: GENERAL_RULES, avoid: [...GENERAL_AVOID, "Overcast or grey-sky photos: this template is bright and sunny."],
    text: [{ at: "start", line: "title", field: "location", example: "Villa · Costa del Sol" }, { at: "end", line: "title", field: "details", example: "5 bed · 4 bath · pool" }],
    approx: ["The short night flicker inside the opening shot is not made.", "The white sweeps are white flashes between shots."],
  },
  {
    key: "front-vs-back", number: 6, name: "The Front vs. The Back", summary: "Show the front of the house, then reveal the back. One big reveal on the beat.",
    frame: "vertical", canvas: "9:16", bpm: 120, music: "confident minimal, clean beat, 120 BPM",
    bounds: [0, 6, 8.5, 12], joins: [cut, cut], use: [0, 1, 2],
    acts: [
      { role: "exterior", light: "day", label: "The front", hint: "The front of the house from the street, with the entrance in view.", essential: true, move: "Slow push toward the house", camera: "push_in" },
      { role: "outdoor", light: "day", label: "The back, wide", hint: "The back garden or pool, wide, as the reveal.", essential: true, move: "Rushes in, then slows on the garden", camera: "whip_in_then_push_in", depth: true },
      { role: "outdoor", light: "day", label: "The back, closer", hint: "A closer view of the pool or terrace.", move: "Enters fast, then slows on the foreground", camera: "whip_in_then_push_in" },
    ],
    ramps: [{ slot: 0, out: true, peak: 3 }, { slot: 1, in: "entry", peak: 2.5, slow: 0.3 }, { slot: 1, out: true, peak: 2.5 }, { slot: 2, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0.03, saturation: 1.1 },
    rules: [...GENERAL_RULES, "Front and back photos from the same day and the same light."],
    avoid: GENERAL_AVOID,
    text: [{ at: "start", line: "title", field: "fixed", example: "THE FRONT" }, { at: "end", line: "title", field: "fixed", example: "VS. THE BACK" }],
    approx: ["'THE FRONT' and 'VS. THE BACK' are not drawn by the template: add them in Titles."],
  },
  {
    key: "greenwood-house", number: 7, name: "Greenwood House", summary: "A cinematic ultra-wide house film: a rising tilt, the entrance, the garden and the kitchen.",
    frame: "cinematic", canvas: "21:9", bpm: 120, music: "cinematic widescreen, orchestral swell, 120 BPM",
    bounds: [0, 2.5, 4.5, 5.5, 6, 8, 11.5, 12.5, 14], joins: [cut, cut, cut, cut, cut, cut, cut], use: [0, 0, 0, 1, 2, 3, 4, 4],
    acts: [
      { role: "exterior", light: "day", label: "The facade", hint: "The house front with open sky above the roof.", essential: true, move: "Tilts up to the open sky", camera: "rise", depth: false },
      { role: "exterior", light: "day", label: "The whole house", hint: "The whole house from the front lawn.", move: "Slow push", camera: "push_in" },
      { role: "entry", light: "any", label: "The entrance", hint: "The front door area, glass doors if you have them.", essential: true, move: "Rushes in, then slows", camera: "whip_in_then_push_in" },
      { role: "outdoor", light: "any", label: "The garden", hint: "The garden seen through trees or plants.", move: "Drifts slowly", camera: "drift", depth: true },
      { role: "kitchen", light: "any", label: "The kitchen", hint: "The kitchen, wide.", essential: true, move: "Glide", camera: "glide" },
    ],
    ramps: [{ slot: 0, in: "entry", peak: 3, slow: 0.4, mid: true }, { slot: 4, in: "entry", peak: 2.5, slow: 0.3 }, { slot: 5, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0.02, saturation: 1.06 },
    rules: [...GENERAL_RULES, "Ultra-wide film (21:9): keep the subject across the middle band of each photo, nothing important near the top or bottom."],
    avoid: GENERAL_AVOID,
    text: [{ at: "start", line: "title", field: "property", example: "Greenwood House" }, { at: "end", line: "title", field: "brand", example: "Your agency" }],
    approx: ["The gold logo reveal is not drawn by the template: add your logo in Titles or as the agent logo."],
  },
  {
    key: "brick-dusk", number: 8, name: "Brick House At Dusk", summary: "A moody dusk film with flash cuts: the lit house, the kitchen, the fireplace, the stairs and a night aerial.",
    frame: "horizontal", canvas: "16:9", bpm: 96, music: "moody dusk, dark pulse and piano, 96 BPM",
    bounds: [0, 0.62, 3.12, 3.75, 5, 5.62, 6.25, 7.5, 8.12, 10, 10.62, 12], joins: [cut, cut, cut, "f", cut, cut, cut, cut, cut, "f"], use: [0, 0, 0, 0, 1, 1, 2, 1, 3, 2, 4],
    acts: [
      { role: "exterior", light: "dusk", label: "The house at dusk", hint: "The house at dusk with windows lit; brick or stone texture helps.", essential: true, move: "Pushes in, then slows on the lit house", camera: "push_in" },
      { role: "kitchen", light: "any", label: "Kitchen", hint: "The kitchen with dark stone or a statement tap.", essential: true, move: "Emerges from a flash, then slows", camera: "whip_in_then_push_in", depth: true },
      { role: "living", light: "any", label: "Living room", hint: "A living room with a fireplace if possible.", essential: true, move: "Slow push", camera: "push_in" },
      { role: "entry", light: "any", label: "Staircase", hint: "The staircase or a hallway.", move: "Slow rise", camera: "rise" },
      { role: "aerial", light: "night", label: "Aerial at night", hint: "A drone view at dusk or night with the lit house and streets.", move: "Emerges from a flash and drifts", camera: "drift" },
    ],
    ramps: [{ slot: 0, out: true, peak: 3 }, { slot: 1, in: "entry", peak: 3, slow: 0.3 }, { slot: 3, out: true, peak: 3.4 }, { slot: 4, in: "settle", peak: 2.5 }, { slot: 9, out: true, peak: 3 }, { slot: 10, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0.03, saturation: 1.05 },
    rules: [...GENERAL_RULES, "Dusk is the mood: the exterior and aerial should be at dusk or night."], avoid: [...GENERAL_AVOID, "Daytime exteriors."],
    text: [{ at: "start", line: "title", field: "property", example: "Brick House" }, { at: "end", line: "title", field: "cta", example: "By appointment" }],
    approx: ["The three 0.1-second micro-shots are one quick shot here.", "The triangle-shaped flash is a plain white flash."],
  },
  {
    key: "framed-architecture", number: 9, name: "Framed Architecture", summary: "Crisp architectural cuts on the beat, ending in a fast sequence that lands on the patio.",
    frame: "horizontal", canvas: "16:9", bpm: 120, music: "bright architectural minimal, piano, 120 BPM",
    bounds: [0, 1, 2.5, 3, 4, 4.5, 7, 8.5, 9, 9.5, 10, 11], joins: [cut, cut, cut, cut, cut, cut, cut, cut, cut, cut], use: [0, 1, 2, 2, 3, 1, 4, 5, 0, 3, 4],
    acts: [
      { role: "bathroom", light: "any", label: "Bathroom", hint: "A bathroom with a double vanity, straight on.", move: "Speeds into the first cut", camera: "glide" },
      { role: "exterior", light: "day", label: "The house, wide", hint: "The modern exterior, wide, in clean light.", essential: true, move: "Settles, then pushes", camera: "push_in" },
      { role: "detail", light: "day", label: "Architectural detail", hint: "A roofline, clerestory or strong geometric detail.", move: "Slow slide", camera: "glide_lateral" },
      { role: "living", light: "any", label: "Living room", hint: "The living room with art or a statement wall.", essential: true, move: "Push", camera: "push_in", depth: true },
      { role: "outdoor", light: "any", label: "Pergola or patio", hint: "A pergola, patio or terrace opening to the garden.", essential: true, move: "Glides in, then slows", camera: "glide", depth: true },
      { role: "detail", light: "any", label: "Skylight or ceiling", hint: "A skylight, ceiling or light shaft.", move: "Slow tilt", camera: "rise" },
    ],
    ramps: [{ slot: 0, out: true, peak: 3 }, { slot: 1, in: "settle", peak: 2.5 }, { slot: 10, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0, saturation: 1.05 },
    rules: GENERAL_RULES, avoid: GENERAL_AVOID,
    text: [{ at: "start", line: "title", field: "property", example: "Framed Architecture" }, { at: "start", line: "sub", field: "headline", example: "Modern living" }],
    approx: ["The painting-frame mask and grid wipe are a plain cut here.", "The last four rapid shots are one beat event on your living and patio photos."],
  },
  {
    key: "never-always-night", number: 10, name: "It Cannot Always Be Night", summary: "A dusk-to-night arrival that builds, flashes white and settles into slow motion. Made for a line of text.",
    frame: "horizontal", canvas: "16:9", bpm: 90, music: "emotional cinematic, piano and strings swell, 90 BPM",
    bounds: [0, 2.67, 6], joins: ["f"], use: [0, 1],
    acts: [
      { role: "exterior", light: "dusk", label: "The villa at dusk", hint: "The house at dusk, front on, with a path or drive leading toward it.", essential: true, move: "A push that speeds up into the flash", camera: "push_in", depth: true },
      { role: "exterior", light: "night", label: "The same villa at night", hint: "The same house and angle at night with lit windows.", essential: true, move: "Slow, steady push to the end", camera: "push_in", depth: true },
    ],
    ramps: [{ slot: 0, out: true, peak: 2.8 }, { slot: 1, in: "entry", peak: 2.5, slow: 0.3 }],
    pairs: [[0, 1]], grade: { warmth: 0.03, saturation: 1.05 },
    rules: [...GENERAL_RULES, "The two photos must be the same house from the same angle. A path leading toward the house gives the best push."], avoid: GENERAL_AVOID,
    text: [{ at: "start", line: "title", field: "fixed", example: "Even if you are not ready for the day" }, { at: "end", line: "title", field: "fixed", example: "It cannot always be night" }],
    approx: ["The reference is one continuous shot with a man walking toward the camera: here it is two photos (dusk, night) joined by the white flash, and no person is added.", "The word-by-word text is not drawn by the template: add it in Titles."],
  },
  {
    key: "curtain-reveal", number: 11, name: "Curtain Reveal", summary: "Curtains open on the living room, the lights come on, then a night-to-day reveal of the house. Calm and dreamy.",
    frame: "horizontal", canvas: "16:9", bpm: 120, music: "dreamy soft piano and pad, 120 BPM",
    bounds: [0, 1, 3, 4.5, 6], joins: [cut, "d0.4", "d0.3"], use: [0, 0, 1, 2],
    acts: [
      { role: "living", light: "any", label: "Living room with curtains", hint: "A living room with a window and curtains, lights on.", essential: true, move: "Slow reveal, then slows on the armchairs and lights", camera: "glide", depth: true },
      { role: "exterior", light: "night", label: "The house at night", hint: "The house at night or dusk, windows lit.", essential: true, move: "Slow push", camera: "push_in" },
      { role: "exterior", light: "day", label: "The house in daylight", hint: "The same house in full daylight.", essential: true, move: "Reveals, then slows on the sunlit house", camera: "whip_in_then_push_in" },
    ],
    ramps: [{ slot: 1, in: "entry", peak: 2.5, slow: 0.3 }, { slot: 2, out: true, peak: 2.5 }, { slot: 3, in: "entry", peak: 2.5, slow: 0.3 }],
    pairs: [[1, 2]], grade: { warmth: 0.03, saturation: 1.08 },
    rules: [...GENERAL_RULES, "Night and day photos of the exterior should be the same angle."], avoid: GENERAL_AVOID,
    text: [{ at: "end", line: "title", field: "brand", example: "Your agency" }],
    approx: ["The curtain opening and the diagonal slice wipe are crossfades here.", "The logo is not drawn by the template."],
  },
  {
    key: "sun-studio", number: 12, name: "Sun Studio", summary: "A warm interior-design reel: tiny detail cuts, a whip into a wide glide, then the name reveal.",
    frame: "horizontal", canvas: "4:3", bpm: 132, music: "warm acoustic, gentle guitar and piano, 132 BPM",
    bounds: [0, 0.45, 0.91, 1.36, 1.82, 3.18, 4.09, 5, 5.91, 7.73, 8.64, 9.55, 12.3], joins: [cut, cut, cut, cut, cut, cut, cut, cut, cut, cut, cut], use: [0, 0, 2, 5, 0, 1, 2, 1, 2, 3, 4, 5],
    acts: [
      { role: "entry", light: "any", label: "Entry or open plan", hint: "A doorway view into the open living and kitchen space.", essential: true, move: "Whips, then a wide glide that slows", camera: "whip_in_then_push_in", depth: true },
      { role: "kitchen", light: "any", label: "Kitchen island", hint: "The kitchen island, wide.", essential: true, move: "Slow slide", camera: "glide_lateral" },
      { role: "detail", light: "any", label: "Kitchen detail", hint: "A close detail: sink, tap or counter.", move: "Slow slide", camera: "glide_lateral" },
      { role: "dining", light: "any", label: "Dining area", hint: "A dining chair and table.", move: "Slow slide", camera: "glide_lateral" },
      { role: "living", light: "any", label: "Living room", hint: "The living room, wide.", move: "Slow push", camera: "push_in" },
      { role: "detail", light: "any", label: "Art wall or shelf", hint: "An art wall or a shelf with objects.", move: "Slow pan along the wall", camera: "glide_lateral" },
    ],
    ramps: [{ slot: 4, in: "entry", peak: 3.5, slow: 0.3 }, { slot: 3, out: true, peak: 3.4 }, { slot: 8, in: "entry", peak: 2.5, slow: 0.3 }, { slot: 11, in: "entry", peak: 2.5, slow: 0.3 }],
    grade: { warmth: 0.05, saturation: 1.1 },
    rules: GENERAL_RULES, avoid: GENERAL_AVOID,
    text: [{ at: "end", line: "title", field: "property", example: "SUN STUDIO" }, { at: "end", line: "sub", field: "location", example: "PORTLAND" }],
    approx: ["This film is 16:9 (4:3 is not one of Studio's frames).", "The masked name reveal is not drawn by the template: add the name in Titles."],
  },
  {
    key: "villa-strobe", number: 13, name: "Villa Strobe Intro", summary: "A 1.7-second punch of three quick villa shots and a white flash. An intro for a longer edit.",
    frame: "horizontal", canvas: "16:9", bounds: [0, 0.43, 0.87, 1.67], joins: [cut, "f"], use: [0, 1, 2],
    acts: [
      { role: "exterior", light: "any", label: "Villa, first view", hint: "A strong view of the villa.", essential: true, move: "Quick push", camera: "push_in" },
      { role: "exterior", light: "any", label: "Villa, second view", hint: "A different angle or the pool.", essential: true, move: "Quick push", camera: "push_in" },
      { role: "exterior", light: "any", label: "Villa, hero view", hint: "The best view of the villa.", essential: true, move: "Quick push", camera: "push_in" },
    ],
    ramps: [{ slot: 1, out: true, peak: 3 }],
    rules: GENERAL_RULES, avoid: GENERAL_AVOID,
    text: [],
    approx: ["The black-and-white, red and white strobe flicker is not made: your colour photos play with one white flash.", "It is 1.7 seconds long and carries no music; use it to open a longer edit."],
  },
];

export const socialSpec = (key: unknown): SocialSpec | null => SOCIAL_SPECS.find((spec) => spec.key === key) || null;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const overlapOf = (join: Join) => join === "c" ? 0.04 : join === "f" ? 0.16 : Number(join.slice(1));
const joinOf = (join: Join): WrenRecipe["joins"][number] => join === "c" ? { type: "cut", dur: 0.04 } : join === "f" ? { type: "flash", dur: 0.16 } : { type: "dissolve", dur: Number(join.slice(1)) };

/* The speed curve of one shot: fast in, slow reveal, back to normal; and/or speeding up into the next cut. Eased, never below 0.3. */
export function speedCurve(dur: number, ramp: Ramp): [number, number][] {
  const peak = Math.min(3.5, Math.max(1.2, ramp.peak || 3)), slow = Math.max(0.3, ramp.slow || 0.3);
  const pts: [number, number][] = [];
  const out = Boolean(ramp.out) && dur >= 0.5;
  if (ramp.in === "settle") pts.push([0, peak], [Math.min(0.45, dur * 0.7), 1], [dur, 1]);
  else if (ramp.in === "entry") {
    if (ramp.mid) pts.push([0, 1], [dur * 0.3, peak], [dur * 0.55, slow], [dur * 0.9, slow], [dur, 1]);
    else if (dur < 1) pts.push([0, peak], [dur * 0.6, slow], [dur, Math.min(1, slow + 0.3)]);
    else {
      const down = Math.min(0.75, dur * 0.55), hold = Math.max(down + 0.1, dur - (out ? 0.9 : 0.4));
      pts.push([0, peak], [Math.min(0.2, dur * 0.2), peak], [down, slow], [hold, slow], [dur, 1]);
    }
  } else pts.push([0, 1], [dur, 1]);
  if (out) {
    const lead = Math.min(0.3, dur * 0.4);
    const keep = pts.filter(([time]) => time < dur - lead - 0.1);
    pts.length = 0; pts.push(...keep, [dur - lead, 1], [dur, peak]);
  }
  // Strictly increasing positions in 0..1, at most 8 points.
  const result: [number, number][] = [];
  for (const [time, speed] of pts) {
    let u = round3(Math.min(1, Math.max(0, time / dur)));
    if (result.length && u <= result[result.length - 1][0]) u = round3(result[result.length - 1][0] + 0.002);
    if (u > 1) continue;
    result.push([u, round3(Math.min(4, Math.max(0.2, speed)))]);
  }
  return result.slice(0, 8);
}

/* How many seconds of footage a shot with this curve eats (the editor plays 8 slices over dur + 0.2). */
export function sourceSeconds(dur: number, speed?: [number, number][]): number {
  if (!speed) return round3(dur + 0.2);
  const at = (u: number) => { if (u <= speed[0][0]) return speed[0][1]; for (let k = 1; k < speed.length; k += 1) if (u <= speed[k][0]) { const [u0, s0] = speed[k - 1], [u1, s1] = speed[k]; return s0 + (s1 - s0) * ((u - u0) / Math.max(1e-6, u1 - u0)); } return speed[speed.length - 1][1]; };
  const total = dur + 0.2, slice = total / 8;
  let source = 0;
  for (let k = 0; k < 8; k += 1) source += slice * at(Math.min(1, ((k + 0.5) * slice) / dur));
  return round3(Math.max(dur + 0.2, source));
}

/* Which photos (acts) are kept when fewer arrive than the template asks for: the optional ones go first, from the end. */
export function keptActs(spec: SocialSpec, count: number): number[] {
  const all = spec.acts.map((_, index) => index);
  if (count >= all.length) return all;
  const keep = Math.max(1, Math.floor(count) || 1);
  const dropOrder = [...all].sort((a, b) => Number(Boolean(spec.acts[a].essential)) - Number(Boolean(spec.acts[b].essential)) || b - a);
  const dropped = new Set(dropOrder.slice(0, all.length - keep));
  return all.filter((index) => !dropped.has(index));
}

/* The recipe: shots on the beat-aligned times, each tied to its photo (by position in `kept`), with ramps. No whoosh sound: standing rule — never in any template. */
export function buildSocialRecipe(spec: SocialSpec, kept: number[] = spec.acts.map((_, index) => index)): WrenRecipe {
  const slotCount = spec.bounds.length - 1;
  const overlaps = spec.joins.map(overlapOf);
  const slots: WrenRecipe["slots"] = Array.from({ length: slotCount }, (_, i) => {
    const dur = round3(spec.bounds[i + 1] - spec.bounds[i] + (overlaps[i - 1] || 0) / 2 + (overlaps[i] || 0) / 2);
    const ramps = spec.ramps.filter((ramp) => ramp.slot === i);
    const merged: Ramp | null = ramps.length ? ramps.reduce((sum, ramp) => ({ ...sum, ...ramp, in: sum.in || ramp.in, out: sum.out || ramp.out }), { slot: i } as Ramp) : null;
    const speed = merged ? speedCurve(dur, merged) : undefined;
    const slot: WrenRecipe["slots"][number] & { photo?: number } = { dur, zoom: [1, 1], pan: [0, 0], ...(speed ? { speed } : {}) };
    const act = spec.use[i] ?? 0;
    const at = kept.indexOf(act);
    slot.photo = at >= 0 ? at : (() => { let best = 0, gap = 1e9; kept.forEach((k, pos) => { const d = Math.abs(k - act) + (k > act ? 0.5 : 0); if (d < gap) { gap = d; best = pos; } }); return best; })();
    return slot;
  });
  const joins = spec.joins.map(joinOf);
  const seconds = round3(slots.reduce((sum, slot) => sum + slot.dur, 0) - joins.reduce((sum, join) => sum + (join.type === "cut" ? 0.04 : join.type === "flash" ? 0.16 : join.dur), 0));
  // Music only, never a whoosh: standing rule — no whoosh sound in any template, ever.
  const audio: NonNullable<WrenRecipe["audio"]> = { ...(spec.music ? { music: { ...(spec.bpm ? { bpm: spec.bpm } : {}), prompt: spec.music } } : {}) };
  return { version: 1, duration: seconds, fps: 30, aspect: spec.canvas === "9:16" ? "vertical" : "horizontal", slots, joins, ...(spec.grade ? { grade: spec.grade } : {}), ...(Object.keys(audio).length ? { audio } : {}) };
}

/* The shortest scene length (seconds) that covers every shot, so no photo's clip runs out. */
export function socialMinScene(spec: SocialSpec, count: number): number {
  const recipe = buildSocialRecipe(spec, keptActs(spec, count));
  return Math.ceil(Math.max(...recipe.slots.map((slot) => sourceSeconds(slot.dur, slot.speed))));
}

/* The photos the template asks for: all of them for the best result, and the fewest that still tell its story. */
export const socialGuide = (spec: SocialSpec) => ({ best: spec.acts.length, least: Math.max(2, spec.acts.filter((act) => act.essential).length) });

/* What a film from this template costs to plan: how many photos it uses (at most one per shot-photo), how long the film
   runs, and how long each photo's clip must be. */
export function socialPlan(spec: SocialSpec, photoCount: number) {
  const count = Math.max(1, Math.min(spec.acts.length, Math.floor(photoCount) || 1));
  const recipe = buildSocialRecipe(spec, keptActs(spec, count));
  return { count, seconds: recipe.duration, minScene: socialMinScene(spec, count) };
}
