/* Cinematic titles: a few words at the start and/or the end of a film, in one of five fonts.

   Clean and minimal: the words fade in with a slight rise over a soft dimming of the picture, hold, and fade out
   (the start), or arrive over the closing seconds and leave with the film's own fade to black (the end).
   Only the words the manager types are drawn. Nothing is read from any reference video. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
export const TITLE_FONTS = [
  { key: "cormorant", label: "Cormorant", file: "CormorantGaramond.ttf", width: 0.74 },
  { key: "playfair", label: "Playfair", file: "PlayfairDisplay.ttf", width: 0.86 },
  { key: "cinzel", label: "Cinzel", file: "Cinzel.ttf", width: 0.92 },
  { key: "montserrat", label: "Montserrat", file: "Montserrat.ttf", width: 0.92 },
  { key: "bodoni", label: "Bodoni", file: "BodoniModa.ttf", width: 0.84 },
];
const FALLBACK = ["/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"];
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/* Spaced capitals: a plain space between letters and a wider gap between words (drawtext has no letter-spacing). Plain spaces exist in
   every font; the hair and em spaces used before are missing from most, and showed as empty boxes between the letters. */
const tracked = (text) => [...text.toUpperCase()].map((ch) => (ch === " " ? "   " : ch)).join(" ");
const fmt = (n) => Number(n).toFixed(3);
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");
const exists = (file) => { try { return fs.existsSync(file); } catch { return false; } };

/* What the titles say, from the Studio's fields. Returns null when there is nothing to show. */
export function cleanTitles(titles) {
  if (!titles || typeof titles !== "object") return null;
  const font = TITLE_FONTS.some((item) => item.key === titles.font) ? titles.font : "cormorant";
  const part = (value) => { const text = clean(value?.text, 60), sub = clean(value?.sub, 80); return text || sub ? { text, sub } : null; };
  const start = part(titles.start), end = part(titles.end);
  return start || end ? { font, start, end } : null;
}

export function fontFile(key) {
  const font = TITLE_FONTS.find((item) => item.key === key) || TITLE_FONTS[0];
  const file = path.join(FONT_DIR, font.file);
  return exists(file) ? file : FALLBACK.find(exists) || FALLBACK[FALLBACK.length - 1];
}

export function planTitles(titles, { width, height, duration, fps }) {
  const cleaned = cleanTitles(titles);
  if (!cleaned) return null;
  const font = TITLE_FONTS.find((item) => item.key === cleaned.font) || TITLE_FONTS[0];
  const file = fontFile(cleaned.font);
  const base = Math.min(width, height);
  const maxWidth = width * 0.82;
  const files = [], parts = [];
  let index = 0;
  const smooth = (a, b) => `clip((t-${fmt(a)})/${fmt(b - a)},0,1)`;
  const fit = (text, start, min) => { let size = start; while (size > min && text.length * size * font.width > maxWidth) size -= 2; return Math.max(min, size); };
  const text = (value, { size, color, alpha, y, at }) => {
    const name = `title-text-${index++}.txt`;
    files.push({ name, text: value });
    const rise = base * 0.016;
    return `drawtext=fontfile='${esc(file)}':textfile='@@DIR@@/${name}':reload=0:fontsize=${Math.round(size)}:fontcolor=${color}:x=(w-text_w)/2:y='${fmt(y)}+${fmt(rise)}*(1-${smooth(at, at + 1)})':alpha='${alpha}':shadowcolor=black@0.35:shadowx=0:shadowy=2`;
  };
  const place = (block, { at, alpha }) => {
    const main = block.text ? tracked(block.text) : "";
    const mainSize = main ? fit(main, base * 0.078, base * 0.034) : 0;
    const subSize = block.sub ? fit(block.sub, base * 0.034, base * 0.02) : 0;
    const gap = main && subSize ? base * 0.03 : 0;
    const total = mainSize + gap + subSize;
    let y = (height - total) / 2;
    if (main) { parts.push({ text: text(main, { size: mainSize, color: "white", alpha, y, at }) }); y += mainSize + gap; }
    if (block.sub) parts.push({ text: text(block.sub, { size: subSize, color: "0xe6dfd3@0.9", alpha, y, at: at + 0.25 }) });
  };
  let startOut = 0, endIn = 0;
  if (cleaned.start) {
    const at = 0.6;
    startOut = Math.min(at + 4, Math.max(at + 2.4, duration * 0.45));
    place(cleaned.start, { at, alpha: `${smooth(at, at + 1)}*clip((${fmt(startOut)}-t)/0.9,0,1)` });
  }
  if (cleaned.end) {
    endIn = Math.max(startOut + 0.5, duration - Math.min(4.2, duration * 0.4));
    place(cleaned.end, { at: endIn + 0.3, alpha: smooth(endIn + 0.3, endIn + 1.3) });
  }
  return { cleaned, files, parts, start: Boolean(cleaned.start), end: Boolean(cleaned.end), startOut, endIn, width, height, duration, fps };
}

/* The filter pieces: a soft dim under the words, then the words. `inLabel` → `outLabel`. */
export function titleGraph(plan, inLabel, outLabel, dir) {
  const { width, height, duration: D, fps } = plan;
  const pieces = [];
  let current = inLabel, n = 0;
  const next = () => `tt${n++}`;
  if (plan.start) {
    const out = next();
    pieces.push(`color=c=0x0a0a0b:s=${width}x${height}:r=${fps}:d=${fmt(D + 1)},format=rgba,fade=t=in:st=0.3:d=0.9:alpha=1,fade=t=out:st=${fmt(plan.startOut - 0.9)}:d=0.9:alpha=1,colorchannelmixer=aa=0.34[dmS${out}]`);
    pieces.push(`[${current}][dmS${out}]overlay=shortest=1:format=auto[${out}]`); current = out;
  }
  if (plan.end) {
    const out = next();
    pieces.push(`color=c=0x0a0a0b:s=${width}x${height}:r=${fps}:d=${fmt(D + 1)},format=rgba,fade=t=in:st=${fmt(plan.endIn)}:d=1.2:alpha=1,colorchannelmixer=aa=0.5[dmE${out}]`);
    pieces.push(`[${current}][dmE${out}]overlay=shortest=1:format=auto[${out}]`); current = out;
  }
  for (const part of plan.parts) {
    const out = next();
    pieces.push(`[${current}]${part.text.replaceAll("@@DIR@@", esc(dir))}[${out}]`); current = out;
  }
  pieces.push(`[${current}]null[${outLabel}]`);
  return pieces;
}
