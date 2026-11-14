/* WrenCut templates: edit styles read from a reference video and kept as a
   recipe — numbers only (shot lengths, joins, zoom, slide, colour). Nothing
   of the reference video itself is stored: no link, no file, no source
   name. Every template is called "MotionWren N". Server- and client-safe
   (no Worker bindings), so plain node can test it. The duration maths must
   match composer/wrencut.mjs (recipeDuration). */

import { filmSceneDurations, type StudioEngineKey, type StudioResolution } from "./engine-catalog";

export type WrenRecipe = {
  version: 1;
  duration: number;
  fps: number;
  aspect: string;
  /** speed: a speed ramp, [position 0..1 along the shot, speed relative to its average][]; blurred where it speeds up. */
  slots: { dur: number; zoom: [number, number]; pan: [number, number]; speed?: [number, number][] }[];
  joins: { type: "cut" | "dissolve" | "flash"; dur: number }[];
  grade?: { warmth: number; saturation: number };
  /** Titles on the reference: where, how big, when and how they come in. Never their words. */
  /** The reference's sound as prompts: its music (tempo, mood) and an effect on some of the joins. No audio is kept. */
  audio?: { music?: { bpm?: number; prompt: string }; sfx?: { join: number; kind: "whoosh" | "hit" | "flash"; lead: number; prompt: string }[] };
};

export type WrenTemplate = {
  id: string;
  name: string;
  seconds: number;
  /** How many different photos the template is built for. */
  photos: number;
  /** The engine this template is made with in Studio (set in WrenCut). */
  engine?: string;
  hasPreview: boolean;
  /** The template carries its own music style (and effects) from the reference. */
  hasMusic?: boolean;
  hasEffects?: boolean;
  /** Shots with a speed ramp. */
  ramps?: number;
  /** Everything the template does, in plain words, for its thumbnail. on=false marks something the reference did not have. */
  effects?: { label: string; on: boolean }[];
  previewUrl?: string;
  active: boolean;
  createdAt: number;
};

export const WREN_PREFIX = "wren:";
export const isWrenId = (value: unknown): value is string => typeof value === "string" && /^wren:[0-9a-f-]{36}$/.test(value);

const overlap = (join: { type: string; dur: number }) => join.type === "cut" ? 0.04 : join.type === "flash" ? 0.16 : join.dur;
export const recipeSeconds = (recipe: WrenRecipe) => Math.round((recipe.slots.reduce((sum, slot) => sum + slot.dur, 0) - recipe.joins.reduce((sum, join) => sum + overlap(join), 0)) * 1000) / 1000;
/* What a template does, in plain words — shown on its thumbnail so the edit's ingredients are visible at a glance. */
export function recipeEffects(recipe: WrenRecipe): { label: string; on: boolean }[] {
  const count = (type: string) => recipe.joins.filter((join) => join.type === type).length;
  const out: { label: string; on: boolean }[] = [];
  const cuts = count("cut"), dissolves = count("dissolve"), flashes = count("flash");
  out.push({ label: `${recipe.slots.length} shots`, on: true });
  if (cuts) out.push({ label: `${cuts} hard ${cuts === 1 ? "cut" : "cuts"}`, on: true });
  if (dissolves) out.push({ label: `${dissolves} ${dissolves === 1 ? "crossfade" : "crossfades"}`, on: true });
  if (flashes) out.push({ label: `${flashes} flash ${flashes === 1 ? "transition" : "transitions"}`, on: true });
  const ramps = recipe.slots.filter((slot) => slot.speed).length;
  out.push(ramps ? { label: `Speed ramps ×${ramps}`, on: true } : { label: "No speed ramps", on: false });
  out.push(ramps ? { label: "Motion blur", on: true } : { label: "No motion blur", on: false });
  const zooms = recipe.slots.filter((slot) => Math.abs(slot.zoom[1] - slot.zoom[0]) > 0.02).length;
  const slides = recipe.slots.filter((slot) => Math.hypot(slot.pan[0], slot.pan[1]) > 0.01).length;
  if (zooms) out.push({ label: `Camera push/pull ×${zooms}`, on: true });
  if (slides) out.push({ label: `Camera slide ×${slides}`, on: true });
  if (recipe.grade) out.push({ label: "Colour look", on: true });
  if (recipe.audio?.music) out.push({ label: recipe.audio.music.bpm ? `Music · ${recipe.audio.music.bpm} BPM` : "Music style", on: true });
  const sfx = recipe.audio?.sfx?.length || 0;
  if (sfx) out.push({ label: `Cut sounds ×${sfx}`, on: true });
  return out;
}

/* Photos the template asks for: one per shot, at most 12 (a photo can fill more than one shot). */
export const recipePhotos = (recipe: WrenRecipe) => Math.max(2, Math.min(12, recipe.slots.length));

export function parseRecipe(value: unknown): WrenRecipe | null {
  try {
    const recipe = (typeof value === "string" ? JSON.parse(value) : value) as WrenRecipe;
    if (!recipe || recipe.version !== 1 || !Array.isArray(recipe.slots) || !Array.isArray(recipe.joins) || recipe.joins.length !== recipe.slots.length - 1 || !recipe.slots.length) return null;
    delete (recipe as { texts?: unknown }).texts; // templates never carry text
    return recipe;
  } catch { return null; }
}

/* The film's shape for a WrenCut template: always the recipe's own length. The
   photos become scenes (at most 12), each made at the shortest engine length that
   covers its share; the editor spreads the scenes over the recipe's shots. */
export function wrenPlan(engine: StudioEngineKey, resolution: StudioResolution, photoCount: number, seconds: number) {
  const count = Math.max(1, Math.min(12, Math.floor(photoCount) || 1));
  const share = seconds / count;
  const allowed = filmSceneDurations(engine, resolution);
  const sceneSeconds = allowed.find((option) => option >= share - 1e-9) || allowed[allowed.length - 1];
  return { count, sceneSeconds, shareSeconds: Math.min(sceneSeconds, Math.round(share * 1000) / 1000), totalSeconds: seconds, resolution };
}

/* When each join falls in the finished film (seconds): the middle of its overlap. */
export function joinTimes(recipe: WrenRecipe): number[] {
  let acc = recipe.slots[0]?.dur || 0;
  return recipe.joins.map((join, index) => {
    const x = overlap(join);
    const time = acc - x + x / 2;
    acc += (recipe.slots[index + 1]?.dur || 0) - x;
    return Math.round(time * 1000) / 1000;
  });
}

