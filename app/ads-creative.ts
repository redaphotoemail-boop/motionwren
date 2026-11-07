/* Studio Ads creative core: the commercial prompt theme, per-scene prompts,
   subtitle timing + .ass text, duration planning and cost estimates.
   Server- and client-safe: no imports from app/api/_lib, no Worker bindings,
   so plain node can test it. */

import { engineCost, scenePlan, type StudioEngineKey, type StudioResolution } from "./engine-catalog";

/* The theme every ad scene is built on. It is NOT the real-estate prompt:
   no static architecture lock, no camera-move list — the engine chooses the
   camera language. What it guarantees instead: premium, cinematic, very
   realistic, true to the supplied images, and never childish or cheesy. */
export const ADS_THEME = "Create a premium, cinematic, high-end commercial. It must look filmed, not generated: true to the supplied images, natural light, believable physics, real textures, filmic colour and gentle grain. The camera language is yours to choose — a confident push, a slow reveal, a smooth lateral move, a subtle orbit — whatever serves the moment best, always steady and intentional, never handheld shake, never a jump cut inside a scene. People move and look like real people: natural faces, hands and posture, no warping, no morphing, no flicker, no melting, no duplicated limbs, no invented objects, no fake text, no distorted logos. Keep every person recognisable as the same person across scenes. Grade it like a broadcast spot: rich contrast, clean highlights, deep but honest colour. Creative and striking, but never childish, never cheesy, never a cartoon, never a meme look.";

export const ADS_NEGATIVE = "warping, morphing, flicker, unstable geometry, fake text, distorted hands, distorted faces, broken continuity, invented objects, unwanted object movement, shake, jitter, cartoon look, childish, cheesy, meme style, oversaturated, plastic skin, melting, duplication";

export const AD_DURATIONS = [10, 30, 60] as const;
export type AdDuration = (typeof AD_DURATIONS)[number];
export type AdAspect = "vertical" | "horizontal" | "square";
export const AD_ASPECTS: { id: AdAspect; label: string; ratio: string }[] = [
  { id: "vertical", label: "Vertical · 9:16 reel", ratio: "9:16" },
  { id: "horizontal", label: "Horizontal · 16:9", ratio: "16:9" },
  { id: "square", label: "Square · 1:1 feed", ratio: "1:1" },
];

/* Engines whose image-to-video endpoint takes a 1:1 aspect ratio. Veo 3.1
   and Gemini Omni take 16:9 / 9:16 only — for them a square ad is made at
   16:9 and the composer center-crops it to square. */
export const AD_SQUARE_ENGINES: ReadonlySet<StudioEngineKey> = new Set([
  "kling3", "wan3", "wan25", "wan27", "hailuo23", "runway45", "runway4turbo", "h3lite", "luma",
]);

export function adAspectRatio(engine: StudioEngineKey, aspect: AdAspect): "16:9" | "9:16" | "1:1" {
  if (aspect === "vertical") return "9:16";
  if (aspect === "square") return AD_SQUARE_ENGINES.has(engine) ? "1:1" : "16:9";
  return "16:9";
}

export type AdActorRef = { name: string; angles: string[] };

export function actorBlock(actors: AdActorRef[]): string {
  if (!actors.length) return "";
  const lines = actors.map((actor) => {
    const angles = actor.angles.length ? ` (reference angles: ${actor.angles.join(", ")})` : "";
    return `Featuring ${actor.name}${angles}. Keep this exact person — same face, same silhouette, same look — in every scene they appear in.`;
  });
  return lines.join(" ");
}

/* One scene's full prompt: theme first, then the hook on scene 0, then the
   user's scene (or whole-ad) prompt, then the actor block. */
export function buildAdScenePrompt({ userPrompt, scenePrompt, hook, sceneIndex, actors }: {
  userPrompt: string;
  scenePrompt?: string;
  hook?: string;
  sceneIndex: number;
  actors?: AdActorRef[];
}): string {
  const parts = [ADS_THEME];
  if (sceneIndex === 0 && hook?.trim()) parts.push(`Opening hook — the first two seconds must land this: ${hook.trim()}.`);
  const scene = (scenePrompt || "").trim() || userPrompt.trim();
  if (scene) parts.push(scene);
  const block = actorBlock(actors || []);
  if (block) parts.push(block);
  return parts.join(" ");
}

/* ---------- durations, scenes, cost ---------- */

export function adPlan(engine: StudioEngineKey, resolution: StudioResolution, targetDuration: AdDuration, photoCount: number, draft = false) {
  const duration = draft ? Math.min(10, targetDuration) : targetDuration;
  const res = draft ? "480p" as StudioResolution : resolution;
  const plan = scenePlan(engine, res, duration, Math.max(1, photoCount));
  return { ...plan, duration, resolution: res };
}

export function estimateAdCost(engine: StudioEngineKey, resolution: StudioResolution, targetDuration: AdDuration, photoCount: number, draft = false): number {
  const plan = adPlan(engine, resolution, targetDuration, photoCount, draft);
  return engineCost(engine, plan.resolution, plan.sceneSeconds * plan.count);
}

/* ---------- subtitles ---------- */

export type SubtitleLine = { start: number; end: number; text: string };
export type SubtitleStyle = { position: "bottom" | "top"; size: "small" | "medium" | "large" };

const SUBTITLE_FONT_SIZE = { small: 36, medium: 48, large: 64 } as const; // at 1080p height

function assTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.floor((clamped % 1) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function assEscape(text: string): string {
  return text.replace(/\r/g, "").replace(/\n/g, "\\N").trim();
}

/* Lines → a complete .ass file for ffmpeg's subtitles filter. The container
   ships Liberation Sans (fonts-liberation2), so that is the font. */
export function buildAssText(lines: SubtitleLine[], style: SubtitleStyle, height = 1080): string {
  const fontSize = Math.max(16, Math.round(SUBTITLE_FONT_SIZE[style.size] * (height / 1080)));
  const alignment = style.position === "top" ? 8 : 2; // 2 bottom-center, 8 top-center
  const events = lines
    .filter((line) => line.text.trim() && line.end > line.start)
    .map((line) => `Dialogue: 0,${assTime(line.start)},${assTime(line.end)},AdDefault,,0,0,0,,${assEscape(line.text)}`);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: AdDefault,Liberation Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,${alignment},20,20,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/* Split a voiceover script (or any text) into timed subtitle lines across
   the film: sentence pieces first, long pieces split on commas, time shared
   out by word count. At most 42 characters a line, at most 16 lines. */
export function splitScriptToSubtitles(script: string, duration: number, maxChars = 42): SubtitleLine[] {
  const words = script.split(/\s+/).filter(Boolean);
  if (!words.length || !(duration > 0)) return [];
  const pieces: string[] = [];
  let current = "";
  const push = (text: string) => { if (text.trim()) pieces.push(text.trim()); };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const sentenceEnd = /[.!?…]$/.test(word);
    if (next.length > maxChars || sentenceEnd) { push(next); current = ""; }
    else current = next;
  }
  push(current);
  // A piece still too long (no sentence end in 42 chars): split on commas, then hard-split.
  const lines: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= maxChars) { lines.push(piece); continue; }
    const commaParts = piece.split(/,\s*/).filter(Boolean);
    let chunk = "";
    for (const part of commaParts) {
      const next = chunk ? `${chunk}, ${part}` : part;
      if (next.length > maxChars && chunk) { lines.push(chunk); chunk = part; }
      else chunk = next;
    }
    if (chunk) lines.push(chunk);
  }
  const capped = lines.slice(0, 16);
  const totalWords = capped.reduce((sum, line) => sum + line.split(/\s+/).length, 0) || 1;
  let at = 0;
  return capped.map((text) => {
    const share = (duration * lineWordCount(text)) / totalWords;
    const line = { start: Math.round(at * 100) / 100, end: Math.round(Math.min(duration, at + share) * 100) / 100, text };
    at += share;
    return line;
  });
  function lineWordCount(text: string) { return text.split(/\s+/).filter(Boolean).length; }
}
