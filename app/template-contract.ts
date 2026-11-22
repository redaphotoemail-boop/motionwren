/* The fixed-recipe contract: one shape every template in the Studio picker must fill in completely, and one checker that
   refuses a template that leaves anything to chance.

   A template is not a description or a prompt. It is a recipe: a numbered shot list with exact start and end times, the
   photo each shot plays, the camera move (from a closed list), the join into it (from a closed list), the music (tempo and
   style, with every cut on the beat), the words on screen (named slots at fixed places), and the quality gates the film is
   held to. Two films made from the same template and the same photos come out with the same structure, every time.

   Pure (type-only imports, no Worker bindings), so plain node can test it. The social templates build their recipe in
   app/social-templates.ts (socialFixedRecipe); the composer's v1 JSON recipes are read here (jsonFixedRecipe). */

import type { TemplateRecipeJson } from "./template-recipes";
import type { SocialSpec } from "./social-templates";
import type { WrenRecipe } from "./wrencut";

/* ---------- closed lists ---------- */

/* What the camera does on a shot. The v1 composer names (composer/template-recipe.mjs) plus rise and drift. */
export const CAMERA_MOVES = {
  push_in: "Slow push in",
  glide: "Glide forward",
  glide_lateral: "Slide sideways",
  rise: "Rise or tilt up",
  drift: "Slow aerial drift",
  tilt_down_glide: "Tilt down, then glide",
  whip_in_then_push_in: "Fast entry, then slow down",
  static: "Hold still",
} as const;
export type CameraMove = keyof typeof CAMERA_MOVES;

/* How a shot comes in. open = the first shot. No whoosh sound on any of them (standing rule). */
export const TRANSITIONS = {
  open: "Opens the film",
  cut: "Hard cut on the beat",
  flash: "White flash on the beat",
  crossfade: "Crossfade",
  whip_blur: "Whip blur on the beat",
} as const;
export type Transition = keyof typeof TRANSITIONS;

/* What a text slot holds. fixed = the template's own words (its example is the text); the rest are filled in per film. */
export const TEXT_FIELDS = {
  property: "Property name",
  headline: "Headline",
  location: "Location",
  price: "Price",
  details: "Beds, baths, features",
  cta: "Call to action",
  brand: "Agent or brand",
  fixed: "The template's own words",
} as const;
export type TextField = keyof typeof TEXT_FIELDS;

/* Text goes where Titles draws it (app/titles.ts): a title and a smaller line under it, at the start and/or the end.
   "timed" is a caption the composer burns in at exact times (the v1 JSON recipes); it is always the template's own words. */
export type TextSlot = { at: "start" | "end"; line: "title" | "sub"; field: TextField; example: string } | { at: "timed"; line: "title"; field: "fixed"; example: string; startS: number; endS: number };
export const TITLE_MAX = 60;
export const SUB_MAX = 80;

/* ---------- the recipe ---------- */

export type FixedShot = {
  n: number;
  start: number;
  end: number;
  seconds: number;
  /** The photo slot this shot plays (0-based), and what that photo must show. */
  photo: number;
  photoLabel: string;
  camera: CameraMove;
  transition: Transition;
  /** Speed ramp on the shot, in plain words ("none" when the shot runs at an even speed). */
  ramp: "none" | "fast in, then slow" | "speeds into the next cut" | "fast in, slow, then speeds out" | "settles from fast";
};

export type FixedPhotoSlot = { label: string; role: string; light: string; essential: boolean };

export type QualityGates = {
  /** The edit's length must match the recipe's length to within this. */
  lengthToleranceS: number;
  /** Every cut inside the film must sit on the music's half-beat grid to within this. */
  beatToleranceS: number;
  /** No shot shorter than this (shorter reads as a glitch, not a cut). */
  minShotS: number;
  /** Speed ramps stay inside this range (slower or faster looks broken). */
  rampRange: [number, number];
  /** The longest clip a shot may need from the engine (seconds). */
  maxClipS: number;
  /** Only the camera moves: architecture, furniture, light and reflections stay still. Always true. */
  cameraOnly: true;
  /** No whoosh or flash sound effects (standing rule). Always true. */
  noWhoosh: true;
};

export const QUALITY_GATES: QualityGates = {
  lengthToleranceS: 0.01,
  beatToleranceS: 0.01,
  minShotS: 0.4,
  rampRange: [0.3, 3.5],
  maxClipS: 12,
  cameraOnly: true,
  noWhoosh: true,
};

export type FixedRecipe = {
  key: string;
  name: string;
  family: "social" | "recipe";
  /** Bumped whenever the recipe's structure changes, so a film can say which recipe it was cut with. */
  version: number;
  canvas: string;
  seconds: number;
  shots: FixedShot[];
  photos: { slots: FixedPhotoSlot[]; best: number; least: number };
  /** null: the template has no music (an intro to a longer edit). */
  music: { bpm: number; style: string } | null;
  text: TextSlot[];
  grade: string;
  quality: QualityGates;
  /** Speed values the edit really uses, so the ramp gate can be checked (one list per shot; empty = even speed). */
  speeds: number[][];
  /** Clip seconds each shot needs from the engine. */
  clipSeconds: number[];
};

/* ---------- the checker ---------- */

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol + 1e-9;

/* Everything wrong with a recipe, in plain words. Empty = the template is a complete, fixed recipe. */
export function validateFixedRecipe(recipe: FixedRecipe): string[] {
  const errors: string[] = [];
  const add = (text: string) => errors.push(`${recipe.name}: ${text}`);
  const q = recipe.quality;
  if (!recipe.key || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(recipe.key)) add("its key must be a lowercase slug.");
  if (!Number.isInteger(recipe.version) || recipe.version < 1) add("it needs a recipe version.");
  if (!recipe.shots.length) add("it has no shots.");
  if (!(recipe.seconds > 0)) add("it has no length.");
  // The shot list: numbered, back to back, from 0 to the end.
  let at = 0;
  recipe.shots.forEach((shot, index) => {
    const label = `shot ${index + 1}`;
    if (shot.n !== index + 1) add(`${label} is numbered ${shot.n}.`);
    if (!near(shot.start, at, 0.002)) add(`${label} starts at ${shot.start} s, not where the last one ended (${at} s).`);
    if (!near(shot.seconds, shot.end - shot.start, 0.002)) add(`${label} says ${shot.seconds} s but runs ${Math.round((shot.end - shot.start) * 1000) / 1000} s.`);
    if (shot.seconds < q.minShotS - 1e-9) add(`${label} is ${shot.seconds} s, shorter than ${q.minShotS} s.`);
    if (!(shot.camera in CAMERA_MOVES)) add(`${label} has an unknown camera move "${shot.camera}".`);
    if (!(shot.transition in TRANSITIONS)) add(`${label} has an unknown join "${shot.transition}".`);
    if ((index === 0) !== (shot.transition === "open")) add(index === 0 ? "the first shot must open the film." : `${label} cannot "open" the film.`);
    if (!Number.isInteger(shot.photo) || shot.photo < 0 || shot.photo >= recipe.photos.slots.length) add(`${label} plays a photo slot that does not exist.`);
    else if (shot.photoLabel !== recipe.photos.slots[shot.photo].label) add(`${label} names the wrong photo.`);
    at = shot.end;
  });
  if (recipe.shots.length && !near(at, recipe.seconds, q.lengthToleranceS)) add(`the shots end at ${at} s but the film is ${recipe.seconds} s.`);
  // Photos: every slot is used, and the counts make sense.
  const used = new Set(recipe.shots.map((shot) => shot.photo));
  recipe.photos.slots.forEach((slot, index) => { if (!used.has(index)) add(`photo "${slot.label}" is never shown.`); if (!slot.label.trim()) add(`photo ${index + 1} has no label.`); });
  if (recipe.photos.best !== recipe.photos.slots.length) add("the best photo count must be every photo slot.");
  if (recipe.photos.least < 1 || recipe.photos.least > recipe.photos.best) add("the fewest photos must be between 1 and the best count.");
  // Music: a tempo, a style that names it, and every cut on the beat.
  if (recipe.music) {
    if (!(recipe.music.bpm >= 40 && recipe.music.bpm <= 200)) add(`music tempo ${recipe.music.bpm} BPM is not a real tempo.`);
    if (!recipe.music.style.trim()) add("the music has no style.");
    if (!recipe.music.style.includes(`${recipe.music.bpm} BPM`)) add("the music style must name its tempo, so the track is made at the speed the cuts were set to.");
    const half = 60 / recipe.music.bpm / 2;
    recipe.shots.slice(1).forEach((shot, index) => {
      const off = shot.start - Math.round(shot.start / half) * half;
      if (Math.abs(off) > q.beatToleranceS + 1e-9) add(`the cut into shot ${index + 2} (${shot.start} s) is ${Math.round(Math.abs(off) * 1000)} ms off the beat.`);
    });
  }
  // Words: named slots in the places Titles can draw, one per place, within its length.
  const places = new Set<string>();
  for (const slot of recipe.text) {
    const place = `${slot.at}.${slot.line}`;
    if (slot.at === "timed") {
      if (slot.field !== "fixed") add("a timed caption must be the template's own words.");
      if (!(slot.startS >= 0 && slot.endS > slot.startS && slot.endS <= recipe.seconds + 1e-9)) add(`caption “${slot.example}” runs outside the film.`);
      if (!slot.example.trim() || slot.example.length > TITLE_MAX) add(`caption “${slot.example}” is empty or too long.`);
      continue;
    }
    if (places.has(place)) add(`two text slots share the ${slot.at} ${slot.line}.`);
    places.add(place);
    if (!(slot.field in TEXT_FIELDS)) add(`text slot ${place} has an unknown field "${slot.field}".`);
    if (!slot.example.trim()) add(`text slot ${place} has no example.`);
    if (slot.example.length > (slot.line === "title" ? TITLE_MAX : SUB_MAX)) add(`text slot ${place} is longer than Titles can draw.`);
    if (slot.line === "sub" && !recipe.text.some((other) => other.at === slot.at && other.line === "title")) add(`text slot ${place} has no title above it.`);
  }
  // Quality gates: ramps in range, clips the engine can make, camera-only, no whoosh.
  recipe.speeds.forEach((list, index) => { if (list.some((speed) => speed < q.rampRange[0] - 1e-9 || speed > q.rampRange[1] + 1e-9)) add(`shot ${index + 1} ramps outside ${q.rampRange[0]}–${q.rampRange[1]}×.`); });
  recipe.clipSeconds.forEach((seconds, index) => { if (seconds > q.maxClipS + 1e-9) add(`shot ${index + 1} needs a ${seconds} s clip, longer than ${q.maxClipS} s.`); });
  if (q.cameraOnly !== true) add("camera-only motion must be on.");
  if (q.noWhoosh !== true) add("the no-whoosh rule must be on.");
  return errors;
}

/* The gates, said plainly, for the guide and Library Studio. */
export function qualityLines(recipe: FixedRecipe): string[] {
  const q = recipe.quality;
  return [
    `Length is exactly ${recipe.seconds} s (to ${Math.round(q.lengthToleranceS * 1000)} ms).`,
    recipe.music ? `Every cut lands on the ${recipe.music.bpm} BPM beat (to ${Math.round(q.beatToleranceS * 1000)} ms).` : "No music: an intro for a longer edit.",
    `No shot shorter than ${q.minShotS} s; speed ramps stay between ${q.rampRange[0]}× and ${q.rampRange[1]}×.`,
    "Only the camera moves: the house, furniture, light and reflections stay still.",
    "Each shot keeps its exact length, so the picture never freezes while the music plays on.",
    "No whoosh sounds.",
  ];
}

export const textSlotLabel = (slot: TextSlot) => slot.at === "timed" ? `Caption at ${slot.startS}–${slot.endS} s: “${slot.example}”` : `${slot.at === "start" ? "Opening" : "Closing"} ${slot.line === "title" ? "title" : "line"}: ${slot.field === "fixed" ? `“${slot.example}”` : `${TEXT_FIELDS[slot.field]} (e.g. ${slot.example})`}`;

/* ---------- the composer's v1 JSON recipes ---------- */

const V1_TRANSITION: Record<string, Transition> = { open: "open", hard_cut: "cut", whip_blur: "whip_blur", crossfade: "crossfade" };
const round3 = (value: number) => Math.round(value * 1000) / 1000;
type V1Scene = TemplateRecipeJson["scenes"][number] & { camera?: { move?: string }; transition_in?: string; captions?: { text: string; start_s: number; end_s: number }[] };

/* A v1 recipe (composer/templates/*.json) in the contract's shape. Its captions are the template's own words, burned in by
   the composer at fixed times, so they are timed text slots; the composer draws them, not Titles. */
export function jsonFixedRecipe(json: TemplateRecipeJson): FixedRecipe {
  const scenes = json.scenes as V1Scene[];
  const slotNames = json.inputs.map((input) => input.slot);
  const music = json.music as { track?: string; cut_points_s?: number[] } | undefined;
  const bpm = Number(/(\d{2,3})\s*BPM/i.exec(music?.track || "")?.[1] || 0);
  const ramps = (json.speed_ramps as { scene: string; points: [number, number][] }[] | undefined) || [];
  const text: TextSlot[] = scenes.flatMap((scene) => scene.captions || []).map((caption) => ({ at: "timed" as const, line: "title" as const, field: "fixed" as const, example: caption.text, startS: caption.start_s, endS: caption.end_s }));
  return {
    key: json.template_id,
    name: json.name,
    family: "recipe",
    version: Number(String(json.recipe_version).split(".")[0]) || 1,
    canvas: json.aspect,
    seconds: json.duration_s,
    shots: scenes.map((scene, index) => ({
      n: index + 1,
      start: round3(scene.start_s),
      end: round3(scene.start_s + scene.duration_s),
      seconds: round3(scene.duration_s),
      photo: Math.max(0, slotNames.indexOf(scene.input || "")),
      photoLabel: scene.input || "",
      camera: (scene.camera?.move || "static") as CameraMove,
      transition: V1_TRANSITION[scene.transition_in || ""] || (scene.transition_in as Transition),
      ramp: ramps.some((ramp) => ramp.scene === scene.id) ? "fast in, slow, then speeds out" : "none",
    })),
    photos: { slots: json.inputs.map((input) => ({ label: input.slot, role: input.slot, light: /night/.test(input.slot) ? "night" : "any", essential: input.required })), best: json.inputs.length, least: json.inputs.filter((input) => input.required).length || 1 },
    music: bpm ? { bpm, style: music?.track || "" } : null,
    text,
    grade: [...new Set(scenes.map((scene) => scene.grade).filter(Boolean))].join(" + "),
    quality: QUALITY_GATES,
    speeds: scenes.map((scene) => (ramps.find((ramp) => ramp.scene === scene.id)?.points || []).map(([, speed]) => speed)),
    clipSeconds: scenes.map((scene) => round3(scene.duration_s)),
  };
}

/* ---------- the social templates ---------- */

/* The recipe version of every social template. Bump it when a template's shot list, joins or text slots change. */
export const SOCIAL_RECIPE_VERSION = 1;

const JOIN_TRANSITION = (join: string): Transition => join === "c" ? "cut" : join === "f" ? "flash" : "crossfade";

function rampLabel(spec: SocialSpec, slot: number): FixedShot["ramp"] {
  const ramps = spec.ramps.filter((ramp) => ramp.slot === slot);
  const entry = ramps.some((ramp) => ramp.in === "entry"), settle = ramps.some((ramp) => ramp.in === "settle"), out = ramps.some((ramp) => ramp.out);
  if (entry && out) return "fast in, slow, then speeds out";
  if (entry) return "fast in, then slow";
  if (settle) return "settles from fast";
  if (out) return "speeds into the next cut";
  return "none";
}

/* A social template (app/social-templates.ts) in the contract's shape. `built` is buildSocialRecipe(spec) and `clips` the
   clip seconds each of its shots needs (sourceSeconds), passed in so this module stays free of value imports. Shot times are
   the beat-aligned bounds; the speeds are the ones the editor really plays. */
export function socialFixedRecipe(spec: SocialSpec, built: WrenRecipe, clips: number[]): FixedRecipe {
  const guideLeast = Math.max(2, spec.acts.filter((act) => act.essential).length);
  return {
    key: spec.key,
    name: spec.name,
    family: "social",
    version: SOCIAL_RECIPE_VERSION,
    canvas: spec.canvas,
    seconds: spec.bounds[spec.bounds.length - 1],
    shots: spec.bounds.slice(0, -1).map((start, index) => {
      const act = spec.use[index] ?? 0;
      return {
        n: index + 1,
        start,
        end: spec.bounds[index + 1],
        seconds: round3(spec.bounds[index + 1] - start),
        photo: act,
        photoLabel: spec.acts[act]?.label || "",
        camera: spec.acts[act]?.camera,
        transition: index === 0 ? "open" : JOIN_TRANSITION(spec.joins[index - 1]),
        ramp: rampLabel(spec, index),
      };
    }),
    photos: { slots: spec.acts.map((act) => ({ label: act.label, role: act.role, light: act.light, essential: Boolean(act.essential) })), best: spec.acts.length, least: guideLeast },
    music: spec.bpm && spec.music ? { bpm: spec.bpm, style: spec.music } : null,
    text: spec.text,
    grade: spec.grade ? `warmth ${spec.grade.warmth}, saturation ${spec.grade.saturation}` : "natural",
    quality: QUALITY_GATES,
    speeds: built.slots.map((slot) => (slot.speed || []).map(([, speed]) => speed)),
    clipSeconds: clips,
  };
}
