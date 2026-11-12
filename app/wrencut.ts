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
  slots: { dur: number; zoom: [number, number]; pan: [number, number] }[];
  joins: { type: "cut" | "dissolve" | "flash"; dur: number }[];
  grade?: { warmth: number; saturation: number };
  /** The reference's sound as prompts: its music (tempo, mood) and an effect on some of the joins. No audio is kept. */
  audio?: { music?: { bpm?: number; prompt: string }; sfx?: { join: number; kind: "whoosh" | "hit" | "flash"; lead: number; prompt: string }[] };
};

export type WrenTemplate = {
  id: string;
  name: string;
  seconds: number;
  /** How many different photos the template is built for. */
  photos: number;
  hasPreview: boolean;
  /** The template carries its own music style (and effects) from the reference. */
  hasMusic?: boolean;
  hasEffects?: boolean;
  previewUrl?: string;
  active: boolean;
  createdAt: number;
};

export const WREN_PREFIX = "wren:";
export const isWrenId = (value: unknown): value is string => typeof value === "string" && /^wren:[0-9a-f-]{36}$/.test(value);

const overlap = (join: { type: string; dur: number }) => join.type === "cut" ? 0.04 : join.type === "flash" ? 0.16 : join.dur;
export const recipeSeconds = (recipe: WrenRecipe) => Math.round((recipe.slots.reduce((sum, slot) => sum + slot.dur, 0) - recipe.joins.reduce((sum, join) => sum + overlap(join), 0)) * 1000) / 1000;
/* Photos the template asks for: one per shot, at most 12 (a photo can fill more than one shot). */
export const recipePhotos = (recipe: WrenRecipe) => Math.max(2, Math.min(12, recipe.slots.length));

export function parseRecipe(value: unknown): WrenRecipe | null {
  try {
    const recipe = (typeof value === "string" ? JSON.parse(value) : value) as WrenRecipe;
    if (!recipe || recipe.version !== 1 || !Array.isArray(recipe.slots) || !Array.isArray(recipe.joins) || recipe.joins.length !== recipe.slots.length - 1 || !recipe.slots.length) return null;
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
