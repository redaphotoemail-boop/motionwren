import type { WrenRecipe } from "./wrencut";

/* Pure helpers that tailor a template to the photos at hand (no imports, so they can be tested on their own). */

const overlap = (join: { type: string; dur: number }) => join.type === "cut" ? 0.04 : join.type === "flash" ? 0.16 : join.dur;

/* The template's shots-per-photo stays the same however many photos arrive: with fewer photos than it was built for,
   it keeps an even spread of its shots (the opening, the middle and the ending all stay), with their moves, ramps and joins. */
export function fitRecipe(recipe: WrenRecipe, photoCount: number, best = Math.max(2, Math.min(12, Math.ceil(recipe.slots.length / 3)))): WrenRecipe {
  const slots = recipe.slots.length;
  const photos = Math.max(1, Math.floor(photoCount) || 1);
  if (photos >= best || slots <= 2) return recipe;
  const keep = Math.max(2, Math.round(slots * photos / best));
  if (keep >= slots) return recipe;
  const picks = Array.from({ length: keep }, (_, index) => Math.round(index * (slots - 1) / (keep - 1)));
  const joins = picks.slice(0, -1).map((pick) => recipe.joins[Math.min(pick, recipe.joins.length - 1)] || { type: "cut" as const, dur: 0.04 });
  const sfx = recipe.audio?.sfx?.flatMap((item) => { const at = picks.slice(0, -1).indexOf(item.join); return at >= 0 ? [{ ...item, join: at }] : []; });
  const next: WrenRecipe = { ...recipe, slots: picks.map((pick) => recipe.slots[pick]), joins, ...(recipe.audio ? { audio: { ...recipe.audio, ...(sfx ? { sfx } : {}) } } : {}) };
  next.duration = Math.round((next.slots.reduce((sum, slot) => sum + slot.dur, 0) - joins.reduce((sum, join) => sum + overlap(join), 0)) * 1000) / 1000;
  return next;
}

/* A whoosh on a join means: the shot before speeds up into it, and the shot after arrives fast and settles into the room.
   Shots that already carry a ramp from the reference keep it; very short shots are left alone. */
export function pairWhooshRamps(recipe: WrenRecipe): WrenRecipe {
  const sfx = recipe.audio?.sfx;
  if (!sfx?.length) return recipe;
  const slots = recipe.slots.map((slot) => ({ ...slot }));
  for (const item of sfx) {
    if (item.kind !== "whoosh" && item.kind !== "flash") continue;
    const before = slots[item.join], after = slots[item.join + 1];
    if (before && before.dur >= 0.5 && !before.speed) before.speed = [[0, 0.8], [0.6, 1], [1, 2.4]];
    if (after && after.dur >= 0.5 && !after.speed) after.speed = [[0, 2.4], [0.35, 1], [1, 0.85]];
  }
  return { ...recipe, slots };
}

/* Story order: the way a listing film walks through a home. */
export const ROOM_ORDER = ["exterior", "entry", "living", "dining", "kitchen", "bedroom", "bathroom", "outdoor"] as const;
export type Room = (typeof ROOM_ORDER)[number];

/* The order the scenes should play in. Scenes whose room is not known keep their place next to the scene before them;
   if most are unknown the original order is kept. Stable: equal rooms keep the order they came in. */
export function storyOrderIndexes(rooms: (Room | null)[]): number[] {
  const known = rooms.filter(Boolean).length;
  const identity = rooms.map((_, index) => index);
  if (known < Math.ceil(rooms.length / 2)) return identity;
  let last = 0;
  const rank = rooms.map((room) => { if (room) last = ROOM_ORDER.indexOf(room); return last; });
  return identity.sort((a, b) => rank[a] - rank[b] || a - b);
}
