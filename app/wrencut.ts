/* WrenCut templates: edit styles read from a reference video and kept as a
   recipe — numbers only (shot lengths, joins, zoom, slide, colour). Nothing
   of the reference video itself is stored: no link, no file, no source
   name. Every template is called "MotionWren N". Server- and client-safe
   (no Worker bindings), so plain node can test it. The duration maths must
   match composer/wrencut.mjs (recipeDuration). */

import type { TitleFx, SubtitleLine } from "./ads-creative";
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
  texts?: { start: number; end: number; x: number; y: number; h: number; caps: boolean; tone?: "light" | "dark"; fx?: TitleFx }[];
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
  /** The titles the template asks for (the words are the customer's). */
  titles?: { at: number; where: "top" | "middle" | "bottom"; caps: boolean; fx?: string }[];
  hasPreview: boolean;
  /** The template carries its own music style (and effects) from the reference. */
  hasMusic?: boolean;
  hasEffects?: boolean;
  /** Shots with a speed ramp. */
  ramps?: number;
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

export const recipeTitles = (recipe: WrenRecipe): NonNullable<WrenTemplate["titles"]> => (recipe.texts || []).map((item) => ({ at: item.start, where: item.y < 0.34 ? "top" : item.y > 0.66 ? "bottom" : "middle", caps: item.caps, ...(item.fx ? { fx: item.fx.type } : {}) }));

/* The recipe's titles with the customer's words (an empty field is skipped: no placeholder text ever shows). */
export function titleLines(recipe: WrenRecipe, words: string[], seconds: number): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  (recipe.texts || []).forEach((item, index) => {
    const raw = String(words[index] || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!raw || item.start >= seconds - 0.3) return;
    lines.push({ text: item.caps ? raw.toUpperCase() : raw, start: item.start, end: Math.min(seconds, Math.max(item.end, item.start + 0.8)), x: item.x, y: item.y, h: item.h, ...(item.tone ? { tone: item.tone } : {}), ...(item.fx ? { fx: item.fx } : {}) });
  });
  return lines;
}
