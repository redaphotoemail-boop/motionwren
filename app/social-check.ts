/* Checks a set of uploaded photos against a social template, before anything is made: how many photos, which photo
   plays in which shot (and in what order), the story (rooms, day or night), the movement each shot will get, and the
   plain photo faults (too small, soft, too dark, wrong shape, near-duplicates). Pure, so it can be tested on its own.
   The reading of the photos themselves (their room, light and depth) is done elsewhere and passed in. */

import type { Act, Light, Role, SocialSpec } from "./social-templates";

/* (Type-only imports keep this file testable with plain node; these two mirror socialGuide and keptActs in social-templates.) */
const guideOf = (spec: SocialSpec) => ({ best: spec.acts.length, least: Math.max(2, spec.acts.filter((act) => act.essential).length) });
const dropLast = (spec: SocialSpec, count: number) => {
  const all = spec.acts.map((_, index) => index);
  if (count >= all.length) return all;
  const order = [...all].sort((a, b) => Number(Boolean(spec.acts[a].essential)) - Number(Boolean(spec.acts[b].essential)) || b - a);
  const dropped = new Set(order.slice(0, all.length - Math.max(1, count)));
  return all.filter((index) => !dropped.has(index));
};

export type PhotoFacts = {
  name?: string; w: number; h: number;
  /** Detail measure of a small copy of the photo (higher is sharper), mean brightness 0..255, and a 64-bit look-alike hash (16 hex). */
  sharp?: number; bright?: number; hash?: string;
  room?: Role | null; light?: Light | null; depth?: boolean | null;
};

export type Finding = { level: "fix" | "tip" | "ok"; text: string; photo?: number };
export type Arrangement = { used: number[]; unused: number[]; kept: number[]; actPhoto: Record<number, number>; score: Record<number, number> };
export type SocialCheck = {
  verdict: "ready" | "good" | "fix"; summary: string;
  arrangement: Arrangement;
  /** For each photo in play order: what it is for, the move it gets. */
  plan: { photo: number; act: number; label: string; move: string }[];
  reordered: boolean;
  findings: Finding[];
};

/* ---------- reading the answers of the photo reader ---------- */
export function parseRoom(answer: string): Role | null {
  const text = String(answer || "").toLowerCase();
  const table: [RegExp, Role][] = [[/aerial|drone|overhead|bird/, "aerial"], [/detail|close-?up|texture/, "detail"], [/exterior|facade|front of/, "exterior"], [/entry|foyer|hall|stair/, "entry"], [/living|family room|lounge|great room/, "living"], [/dining/, "dining"], [/kitchen/, "kitchen"], [/bed/, "bedroom"], [/bath|shower|toilet/, "bathroom"], [/outdoor|patio|pool|yard|garden|view|deck|terrace/, "outdoor"]];
  for (const [pattern, room] of table) if (pattern.test(text)) return room;
  return null;
}
export function parseLight(answer: string): Light | null {
  const text = String(answer || "").toLowerCase();
  if (/night|dark/.test(text)) return "night";
  if (/dusk|sunset|twilight|evening|golden/.test(text)) return "dusk";
  if (/day|sun|bright|noon|morning/.test(text)) return "day";
  return null;
}
export const parseYes = (answer: string): boolean | null => /\byes\b/i.test(answer || "") ? true : /\bno\b/i.test(answer || "") ? false : null;

/* ---------- plain measures from pixels (run in the browser on a small copy) ---------- */
export function analyzePixels(rgba: ArrayLike<number>, w: number, h: number): { sharp: number; bright: number; hash: string } {
  const gray = new Float64Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i += 1) { const v = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]; gray[i] = v; sum += v; }
  const bright = sum / Math.max(1, w * h);
  let mean = 0, sq = 0, count = 0;
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const at = y * w + x, lap = 4 * gray[at] - gray[at - 1] - gray[at + 1] - gray[at - w] - gray[at + w];
    mean += lap; sq += lap * lap; count += 1;
  }
  const sharp = count ? sq / count - (mean / count) ** 2 : 0;
  // 8x8 average hash: each cell above or below the photo's own mean.
  const cells: number[] = [];
  for (let cy = 0; cy < 8; cy += 1) for (let cx = 0; cx < 8; cx += 1) {
    let total = 0, n = 0;
    for (let y = Math.floor(cy * h / 8); y < Math.floor((cy + 1) * h / 8); y += 1) for (let x = Math.floor(cx * w / 8); x < Math.floor((cx + 1) * w / 8); x += 1) { total += gray[y * w + x]; n += 1; }
    cells.push(n ? total / n : 0);
  }
  const mid = cells.reduce((a, b) => a + b, 0) / 64;
  let hash = "";
  for (let nibble = 0; nibble < 16; nibble += 1) { let value = 0; for (let bit = 0; bit < 4; bit += 1) value = value * 2 + (cells[nibble * 4 + bit] > mid ? 1 : 0); hash += value.toString(16); }
  return { sharp: Math.round(sharp * 10) / 10, bright: Math.round(bright * 10) / 10, hash };
}
export function hamming(a?: string, b?: string): number | null {
  if (!a || !b || a.length !== 16 || b.length !== 16) return null;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { bits += x & 1; x >>= 1; } }
  return bits;
}

/* ---------- which photo for which shot ---------- */
const NEAR: Partial<Record<Role, Role[]>> = { living: ["dining", "entry"], dining: ["living", "kitchen"], kitchen: ["dining", "living"], outdoor: ["exterior", "aerial"], exterior: ["outdoor", "aerial", "entry"], aerial: ["exterior", "outdoor"], entry: ["living", "exterior"], detail: ["living", "dining", "kitchen", "bathroom", "bedroom", "exterior"], bedroom: ["living"], bathroom: [] };
const roomScore = (act: Act, photo: PhotoFacts) => act.role === "any" ? 2 : !photo.room ? 1 : photo.room === act.role ? 4 : NEAR[act.role]?.includes(photo.room) ? 2 : 0;
const lightScore = (act: Act, photo: PhotoFacts) => act.light === "any" ? 1 : !photo.light ? 0.5 : photo.light === act.light ? 2 : (photo.light === "dusk" && act.light === "night") || (photo.light === "night" && act.light === "dusk") ? 1.2 : 0;
export const fit = (act: Act, photo: PhotoFacts) => roomScore(act, photo) + lightScore(act, photo);

/* Gives each shot-photo of the template the best-fitting uploaded photo, keeping the upload order when nothing tells them apart. */
export function arrangePhotos(spec: SocialSpec, photos: PhotoFacts[]): Arrangement {
  const n = photos.length, acts = spec.acts;
  const wanted = Math.min(n, acts.length);
  // With fewer photos than the template asks for, keep the essential shots, then the shots the photos fit best.
  let kept = acts.map((_, index) => index);
  if (n < acts.length) {
    const best = acts.map((act) => Math.max(0, ...photos.map((photo) => fit(act, photo))));
    const rank = [...kept].sort((a, b) => Number(Boolean(acts[b].essential)) - Number(Boolean(acts[a].essential)) || best[b] - best[a] || a - b);
    const chosen = new Set(rank.slice(0, wanted));
    kept = kept.filter((index) => chosen.has(index));
    if (!photos.some((photo) => photo.room || photo.light)) kept = dropLast(spec, n);
  }
  const pairs: { act: number; photo: number; score: number }[] = [];
  for (const act of kept) photos.forEach((photo, index) => pairs.push({ act, photo: index, score: fit(acts[act], photo) }));
  // Best fits first; equal fits keep the upload order (photo n goes to the n-th shot).
  pairs.sort((a, b) => b.score - a.score || Math.abs(a.photo - a.act) - Math.abs(b.photo - b.act) || a.act - b.act || a.photo - b.photo);
  const actPhoto: Record<number, number> = {}, score: Record<number, number> = {}, taken = new Set<number>();
  for (const pair of pairs) { if (actPhoto[pair.act] !== undefined || taken.has(pair.photo)) continue; actPhoto[pair.act] = pair.photo; score[pair.act] = pair.score; taken.add(pair.photo); }
  const used = kept.filter((act) => actPhoto[act] !== undefined).map((act) => actPhoto[act]);
  const unused = photos.map((_, index) => index).filter((index) => !taken.has(index));
  return { used, unused, kept, actPhoto, score };
}

/* ---------- the checking ---------- */
const frameRatio = (spec: SocialSpec) => spec.frame === "vertical" ? 9 / 16 : spec.frame === "cinematic" ? 21 / 9 : 16 / 9;
const nameOf = (photos: PhotoFacts[], index: number) => photos[index]?.name ? `“${photos[index].name}”` : `photo ${index + 1}`;
const lightWord: Record<Light, string> = { day: "daylight", dusk: "dusk", night: "night", any: "any light" };
const roomWord: Record<Role, string> = { exterior: "the outside of the house", aerial: "an aerial view", entry: "an entrance or hall", living: "a living room", dining: "a dining room", kitchen: "a kitchen", bedroom: "a bedroom", bathroom: "a bathroom", outdoor: "a garden, pool or terrace", detail: "a detail", any: "any space" };

export function checkSocialPhotos(spec: SocialSpec, photos: PhotoFacts[]): SocialCheck {
  const guide = guideOf(spec), findings: Finding[] = [];
  const add = (level: Finding["level"], text: string, photo?: number) => findings.push({ level, text, ...(photo !== undefined ? { photo } : {}) });
  const n = photos.length;
  const arrangement = arrangePhotos(spec, photos);
  const { actPhoto, used, unused, kept } = arrangement;

  // How many photos.
  if (n < guide.least) add("fix", `This template needs at least ${guide.least} photos to tell its story (best: ${guide.best}). You have ${n}: add ${guide.least - n} more.`);
  else if (n < guide.best) {
    const dropped = spec.acts.filter((_, index) => !kept.includes(index)).map((act) => act.label.toLowerCase());
    add("tip", `${guide.best} photos give the full template; with ${n} the film leaves out ${dropped.join(" and ")}.`);
  } else add("ok", `${n >= guide.best ? "Enough" : "The right number of"} photos for this template.`);
  if (n > guide.best) add("tip", `The template only has room for ${guide.best} photos. ${unused.map((index) => nameOf(photos, index)).join(", ")} ${unused.length === 1 ? "is" : "are"} left out, and you are not charged for ${unused.length === 1 ? "it" : "them"}.`, unused[0]);

  // Story and order: each shot's photo.
  for (const act of kept) {
    const index = actPhoto[act];
    if (index === undefined) continue;
    const photo = photos[index], line = spec.acts[act];
    const room = roomScore(line, photo), light = lightScore(line, photo);
    if (line.role !== "any" && photo.room && room < 2) add("fix", `${nameOf(photos, index)} looks like ${roomWord[photo.room]}, but this shot is for ${line.label.toLowerCase()} (${roomWord[line.role]}). ${line.hint}`, index);
    else if (line.essential && line.role !== "any" && !photo.room) add("tip", `I could not tell what ${nameOf(photos, index)} shows. This shot is for ${line.label.toLowerCase()}: ${line.hint}`, index);
    if (line.light !== "any" && photo.light && light < 1) add("fix", `${nameOf(photos, index)} looks like ${lightWord[photo.light]}, but “${line.label}” needs ${lightWord[line.light]}. ${line.hint}`, index);
    if (line.depth && photo.depth === false) add("tip", `${nameOf(photos, index)}: the camera ${line.move.toLowerCase()}, but this photo shows little depth to travel into. A view down a hall or across a room gives a smoother move.`, index);
  }
  for (const act of kept) if (actPhoto[act] === undefined) add("fix", `No photo for “${spec.acts[act].label}”. ${spec.acts[act].hint}`);

  // The photos themselves.
  const targetRatio = frameRatio(spec);
  used.forEach((index) => {
    const photo = photos[index], side = Math.min(photo.w, photo.h), ratio = photo.w / Math.max(1, photo.h);
    const night = photo.light === "night" || photo.light === "dusk";
    if (side && side < 600) add("fix", `${nameOf(photos, index)} is small (${photo.w}×${photo.h}). Use the original photo, at least 1080 pixels on the short side.`, index);
    else if (side && side < 900) add("tip", `${nameOf(photos, index)} is only ${photo.w}×${photo.h}: bigger photos give a sharper film.`, index);
    if (spec.frame === "vertical" && ratio > 1.15) add("tip", `${nameOf(photos, index)} is landscape and this film is vertical: the sides are cropped to the middle. Keep what matters in the centre, or use a portrait photo.`, index);
    if (spec.frame !== "vertical" && ratio < 0.9) add("fix", `${nameOf(photos, index)} is a portrait photo and this film is widescreen: most of it would be cut away. Use a landscape photo.`, index);
    if (spec.frame === "cinematic" && ratio >= 0.9 && ratio < 1.6) add("tip", `This film is ultra-wide (${spec.canvas}): the top and bottom of ${nameOf(photos, index)} are cropped, so keep what matters in the middle band.`, index);
    if (photo.sharp !== undefined && photo.sharp < (night ? 9 : 18)) add("fix", `${nameOf(photos, index)} looks soft or out of focus. Re-shoot or choose a sharper one.`, index);
    else if (photo.sharp !== undefined && photo.sharp < (night ? 20 : 40)) add("tip", `${nameOf(photos, index)} is a little soft.`, index);
    if (photo.bright !== undefined) {
      if (photo.bright > 228) add("fix", `${nameOf(photos, index)} is overexposed (washed out).`, index);
      else if (photo.bright < (night ? 14 : 38)) add("fix", `${nameOf(photos, index)} is very dark${night ? ": light the scene (lamps, pool light, windows) and shoot again" : ""}.`, index);
    }
    void targetRatio;
  });
  // The same photo twice.
  const sameView = new Set((spec.pairs || []).flatMap(([x, y]) => actPhoto[x] !== undefined && actPhoto[y] !== undefined ? [`${Math.min(actPhoto[x], actPhoto[y])}-${Math.max(actPhoto[x], actPhoto[y])}`] : []));
  for (let a = 0; a < used.length; a += 1) for (let b = a + 1; b < used.length; b += 1) {
    if (sameView.has(`${Math.min(used[a], used[b])}-${Math.max(used[a], used[b])}`)) continue; // a day and a night photo of one view are meant to match
    const gap = hamming(photos[used[a]].hash, photos[used[b]].hash);
    if (gap !== null && gap <= 4) add("fix", `${nameOf(photos, used[a])} and ${nameOf(photos, used[b])} are almost the same photo. Replace one with a different view.`, used[b]);
  }
  // Pairs that must be the same view (day and night).
  for (const [x, y] of spec.pairs || []) {
    const i = actPhoto[x], j = actPhoto[y];
    if (i === undefined || j === undefined) continue;
    const gap = hamming(photos[i].hash, photos[j].hash);
    if (gap !== null && gap > 26) add("tip", `${spec.acts[x].label} and ${spec.acts[y].label.toLowerCase()} do not look like the same view. This template works best when both are shot from the same spot.`, j);
    else if (gap !== null) add("ok", `${spec.acts[x].label} and ${spec.acts[y].label.toLowerCase()} line up well.`);
  }

  // The order the film will play, and the move each shot gets.
  const identity = used.every((index, position) => index === position);
  const plan = kept.filter((act) => actPhoto[act] !== undefined).map((act) => ({ photo: actPhoto[act], act, label: spec.acts[act].label, move: spec.acts[act].move }));
  if (!identity) add("ok", `I will play your photos in this order: ${plan.map((step, position) => `${position + 1}. ${nameOf(photos, step.photo)} (${step.label.toLowerCase()})`).join(" · ")}.`);
  else add("ok", "Your photos are already in the right order.");
  const fixes = findings.filter((item) => item.level === "fix").length, tips = findings.filter((item) => item.level === "tip").length;
  const verdict: SocialCheck["verdict"] = fixes ? "fix" : tips ? "good" : "ready";
  const summary = verdict === "ready" ? "Ready: these photos fit this template." : verdict === "good" ? `Good to go, ${tips} ${tips === 1 ? "tip" : "tips"} for an even better result.` : `${fixes} ${fixes === 1 ? "thing" : "things"} to fix for the best result.`;
  return { verdict, summary, arrangement, plan, reordered: !identity, findings };
}
