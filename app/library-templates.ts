/* Library Studio templates: recorded video templates, rebuilt from
   CapCut templates Reda picks. A template is a fixed structure — length,
   aspect, photo slots, cuts, grade, music mood — with a few fill-in
   fields per ad. An admin switches a template on in Library Studio and
   it appears as a choice when producing a Studio Ad; off stays hidden.
   Server- and client-safe: no imports from app/api/_lib, no Worker
   bindings, so plain node can test it — the same rule as
   ads-master-prompt.ts. It does NOT touch ADS_THEME: the cinematic
   premium prompt stays exactly as it is, and a library template's theme
   is layered in its place only when picked. With no library template
   selected, the site behaves exactly as it does today. */

import { engineCost, filmSceneDurations, type StudioEngineKey, type StudioResolution } from "./engine-catalog";
import type { MasterPromptFields } from "./ads-master-prompt";
import type { SubtitleLine } from "./ads-creative";

export type LibraryTemplateId = "none" | "restaurant-interior";

/* A library template is 17 s, like the CapCut original it rebuilds. */
export const LIBRARY_TEMPLATE_DURATION = 17;
export const LIBRARY_TEMPLATE_MUSIC_MOOD = "luxe";

export type LibraryTemplate = {
  id: Exclude<LibraryTemplateId, "none">;
  name: string;
  blurb: string;
  durationSeconds: number;
  aspect: "vertical";
  photoSlots: number;
  musicMood: string;
  source: string;
  /** A short preview clip shown on the template's tile, when one exists. */
  previewUrl?: string;
};

export const LIBRARY_TEMPLATES: LibraryTemplate[] = [
  {
    id: "restaurant-interior",
    name: "Restaurant Interior",
    blurb: "17 s vertical showcase — 8 photos, hard cuts, title + website. Rebuilt from the CapCut template by Treztive.",
    durationSeconds: 17,
    aspect: "vertical",
    photoSlots: 8,
    musicMood: "luxe",
    source: "CapCut template by Treztive",
  },
];

export function resolveLibraryTemplate(value: unknown): LibraryTemplateId {
  return value === "restaurant-interior" ? "restaurant-interior" : "none";
}

/* ---------- the 5 fill-in fields ---------- */

export type LibraryTemplateFields = {
  brandName: string;
  titleLine1: string;
  titleLine2: string;
  location: string;
  website: string;
};

export type LibraryTemplateFieldDef = {
  key: keyof LibraryTemplateFields;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline: boolean;
};

export const LIBRARY_TEMPLATE_FIELD_DEFS: LibraryTemplateFieldDef[] = [
  { key: "brandName", label: "Brand name", placeholder: "e.g. Treztive — shown top-centre on every scene", maxLength: 60, multiline: false },
  { key: "titleLine1", label: "Title line 1", placeholder: "e.g. Restaurant", maxLength: 60, multiline: false },
  { key: "titleLine2", label: "Title line 2", placeholder: "e.g. INTERIOR", maxLength: 60, multiline: false },
  { key: "location", label: "Location", placeholder: "e.g. Street name, City", maxLength: 120, multiline: false },
  { key: "website", label: "Website", placeholder: "e.g. www.example.com", maxLength: 120, multiline: false },
];

export function emptyRestaurantInteriorFields(): LibraryTemplateFields {
  return { brandName: "", titleLine1: "", titleLine2: "", location: "", website: "" };
}

/* Clean raw input (from the form or the API) into the template id + the 5
   fields: trim, cap each length, drop anything else. Unknown or missing
   input → no template, empty fields. */
export function cleanLibraryTemplateFields(value: unknown): { libraryTemplate: LibraryTemplateId; fields: LibraryTemplateFields } {
  const fields = emptyRestaurantInteriorFields();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { libraryTemplate: "none", fields };
  const raw = value as Record<string, unknown>;
  const libraryTemplate = resolveLibraryTemplate(raw.libraryTemplate);
  for (const def of LIBRARY_TEMPLATE_FIELD_DEFS) {
    const item = raw[def.key];
    if (typeof item === "string") fields[def.key] = item.trim().slice(0, def.maxLength);
  }
  return { libraryTemplate, fields };
}

export function parseLibraryTemplateFields(value: string): { libraryTemplate: LibraryTemplateId; fields: LibraryTemplateFields } {
  try {
    return cleanLibraryTemplateFields(JSON.parse(value || "{}") as unknown);
  } catch {
    return { libraryTemplate: "none", fields: emptyRestaurantInteriorFields() };
  }
}

/* One object for the template_fields column: the master-prompt fields,
   the library template id, and the library fields. Each parser reads
   only its own axis out of it again. */
export function mergeTemplateFields(masterFields: MasterPromptFields, library: { libraryTemplate: LibraryTemplateId; fields: LibraryTemplateFields }): Record<string, unknown> {
  return { ...masterFields, libraryTemplate: library.libraryTemplate, ...library.fields };
}

/* ---------- the template theme ---------- */

/* Warm golden editorial restaurant-interior showcase, rebuilt from the
   CapCut template by Treztive: static photos, hard cuts, title text and
   a website end card. No real-estate language anywhere. */
export const LIBRARY_TEMPLATE_THEME = "Create a warm, golden, editorial restaurant-interior showcase. Hold each photo exactly as shot: a static camera, no pan, no zoom, no movement inside a scene — the cut does the work. Stay true to the supplied photos: the real rooms, the real light, the real details, nothing added or rearranged. Grade it warm and golden, rich contrast, soft warm light, like a high-end interiors editorial. Elegant and premium, calm and unhurried, never childish, never cheesy, never a cartoon, never a meme look.";

/* ---------- plan + estimate ---------- */

/* The film's shape for a library template: the full 17 s over up to 8
   photos (a draft is 10 s at 480p over the first 4 scenes only), each
   scene made at the shortest engine length that covers its share and
   trimmed to it. With 1 photo the share (17 s) is longer than any
   engine's longest scene, so the film is as long as that one scene
   allows — the template needs at least 2 photos for the full 17 s. */
export function libraryTemplatePlan(engine: StudioEngineKey, resolution: StudioResolution, photoCount: number, draft = false) {
  const total = draft ? 10 : LIBRARY_TEMPLATE_DURATION;
  const maxCount = draft ? 4 : 8;
  const count = Math.max(1, Math.min(maxCount, Math.floor(photoCount) || 1));
  const res = draft ? "480p" as StudioResolution : resolution;
  const share = total / count;
  const allowed = filmSceneDurations(engine, res);
  const longest = allowed[allowed.length - 1];
  const sceneSeconds = allowed.find((option) => option >= share - 1e-9) || longest;
  const capped = sceneSeconds < share;
  return {
    count,
    sceneSeconds,
    shareSeconds: capped ? sceneSeconds : Math.round(share * 1000) / 1000,
    totalSeconds: capped ? count * sceneSeconds : total,
    resolution: res,
  };
}

export function libraryTemplateEstimate(engine: StudioEngineKey, photoCount: number, draft = false): number {
  const plan = libraryTemplatePlan(engine, draft ? "480p" : "1080p", photoCount, draft);
  return engineCost(engine, plan.resolution, plan.sceneSeconds * plan.count);
}

/* ---------- the text overlays ---------- */

/* The template's burned-in text: the brand top-centre on every scene,
   the title block centred on the first two scenes, the website centred
   on the last scene. A field left empty is skipped — no placeholder
   text ever appears in the video. */
export function libraryTemplateOverlayLines(templateId: LibraryTemplateId, fields: LibraryTemplateFields, totalSeconds: number, shareSeconds: number): SubtitleLine[] {
  if (templateId === "none") return [];
  const round3 = (value: number) => Math.round(value * 1000) / 1000;
  const titleEnd = round3(2 * shareSeconds);
  const lines: SubtitleLine[] = [];
  if (fields.brandName.trim()) lines.push({ text: fields.brandName, start: 0, end: round3(totalSeconds), position: "top", size: "small" });
  if (fields.titleLine1.trim()) lines.push({ text: fields.titleLine1, start: 0, end: titleEnd, position: "center", size: "large" });
  if (fields.titleLine2.trim()) lines.push({ text: fields.titleLine2, start: 0, end: titleEnd, position: "center", size: "large" });
  if (fields.location.trim()) lines.push({ text: fields.location, start: 0, end: titleEnd, position: "center", size: "medium" });
  if (fields.website.trim()) lines.push({ text: fields.website, start: round3(totalSeconds - shareSeconds), end: round3(totalSeconds), position: "center", size: "medium" });
  return lines;
}

/* ---------- the admin on/off map ---------- */

/* The enabled map lives in platform_settings under
   'library_templates_enabled' as a JSON object of id → boolean. A
   template with nothing stored shows until it is switched off. */
export function parseLibraryEnabled(value: unknown): Record<string, boolean> {
  let raw: unknown = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value || "{}") as unknown; } catch { return {}; }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof item === "boolean") out[key] = item;
  }
  return out;
}

export function isLibraryTemplateVisible(id: string, enabled: Record<string, boolean>): boolean {
  return enabled[id] !== false;
}
