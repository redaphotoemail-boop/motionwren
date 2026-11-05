/* The opening property card and the closing agent card, burned into the film by the editor.

   Same look as the Studio's preview (app/studio/overlays.ts): a centred serif title
   over small spaced capitals, no boxes. The opening fades in over a soft vignette and
   out again; near the end the film dims to dark, the agent card appears on the dark,
   and the editor's final fade takes everything to black. Doing it here means every
   film comes out with its cards: no browser has to stay open. */

import fs from "node:fs";

const SERIF = ["/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"];
const SANS = ["/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
const pick = (list) => list.find((file) => { try { return fs.existsSync(file); } catch { return false; } }) || list[list.length - 1];

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/* Spaced capitals: a hair space between letters (drawtext has no letter-spacing). */
const tracked = (text) => [...text.toUpperCase()].map((ch) => (ch === " " ? "\u2003" : ch)).join("\u200a");

/* What the cards say, from the Studio's fields. Returns null when there is nothing to show. */
export function cardTexts(cards) {
  if (!cards || typeof cards !== "object") return null;
  const o = cards.opening || {}, c = cards.closing || {};
  const opening = {
    title: clean(o.title, 80), detail: clean(o.detail, 140), message: clean(o.message, 120),
  };
  const closing = { name: clean(c.name, 80), contact: clean(c.contact, 140), logo: typeof c.logo === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(c.logo) && c.logo.length < 3_000_000 ? c.logo : "" };
  const hasOpening = Boolean(opening.title || opening.detail || opening.message);
  const hasClosing = Boolean(closing.name || closing.contact || closing.logo);
  if (!hasOpening && !hasClosing) return null;
  return { opening: hasOpening ? opening : null, closing: hasClosing ? closing : null };
}

const GAP = { eyebrow: 26, title: 28, rule: 30, logo: 38, detail: 22, note: 14 };

/* Largest size (down to min) at which the text fits, using an average glyph width per size. */
function fitSize(text, start, min, factor, maxWidth) {
  let size = start;
  while (size > min && text.length * size * factor > maxWidth) size -= 2;
  return Math.max(min, size);
}

/* Lays out a card's rows as one centred block (positions in pixels). */
function layout(rows, width, height, u) {
  const total = rows.reduce((sum, row, i) => sum + row.size + (i < rows.length - 1 ? GAP[row.kind] * u : 0), 0);
  let y = (height - total) / 2;
  return rows.map((row) => { const placed = { ...row, y }; y += row.size + GAP[row.kind] * u; return placed; });
}

const fmt = (n) => Number(n).toFixed(3);
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,");

/* Everything the editor needs to draw the cards:
   - files: small files to write (the texts, and the logo) and the extra inputs to add;
   - build(inLabel, outLabel, firstExtraInput): the filter graph pieces. */
export function planCards(cards, { width, height, duration, fps, single = false }) {
  const texts = cardTexts(cards);
  if (!texts) return null;
  const u = width / (width >= height ? 1280 : 800);
  const maxWidth = width - 150 * u;
  const files = []; // { name, text } to write as text files
  const filters = []; // pieces, each ends with its own output label except text chains (built in order)
  const inputs = []; // extra ffmpeg inputs: [-loop 1 -i vignette] etc. (as arrays of args)
  const serif = pick(SERIF), sans = pick(SANS);

  const D = duration;
  const smoothEnv = (a, b) => `clip((t-${fmt(a)})/${fmt(b - a)},0,1)`; // 0→1 between a and b
  let textIndex = 0;
  const addText = (text, { font, size, color, alpha, y, riseAt, shadow = false }) => {
    const name = `card-text-${textIndex++}.txt`;
    files.push({ name, text });
    const rise = 12 * u;
    const yExpr = `${fmt(y)}+${fmt(rise)}*(1-${smoothEnv(riseAt, riseAt + 0.9)})`;
    return `drawtext=fontfile='${esc(font)}':textfile='@@DIR@@/${name}':reload=0:fontsize=${Math.round(size)}:fontcolor=${color}:x=(w-text_w)/2:y='${yExpr}':alpha='${alpha}'${shadow ? ":shadowcolor=black@0.4:shadowx=0:shadowy=2" : ""}`;
  };

  /* ---- opening ---- */
  const opening = texts.opening;
  let openingEnd = 0;
  if (opening) {
    const openStart = 0.5;
    openingEnd = Math.min(openStart + 4.2, Math.max(openStart + 2.4, D * 0.5));
    const env = `${smoothEnv(openStart, openStart + 1)}*clip((${fmt(openingEnd)}-t)/0.9,0,1)`;
    const rows = [];
    if (opening.title) rows.push({ kind: "eyebrow", size: 14 * u, text: tracked("Now presenting") }, { kind: "title", size: 64 * u, text: opening.title });
    if (opening.title && (opening.detail || opening.message)) rows.push({ kind: "rule", size: Math.max(1, u) });
    if (opening.detail) rows.push({ kind: "detail", size: 15 * u, text: tracked(opening.detail) });
    if (opening.message) rows.push({ kind: "note", size: 18 * u, text: opening.message });
    const placed = layout(rows, width, height, u);
    const start = openStart + 0.1;
    placed.forEach((row, i) => {
      const at = start + i * 0.2;
      const alpha = `${env}*${smoothEnv(at, at + 0.9)}`;
      if (row.kind === "rule") { filters.push({ rule: { y: row.y, at, end: openingEnd, h: row.size } }); return; }
      if (row.kind === "eyebrow") filters.push({ text: addText(row.text, { font: sans, size: row.size, color: "white@0.66", alpha, y: row.y - row.size * 0.15, riseAt: at, shadow: true }) });
      else if (row.kind === "title") { const size = fitSize(row.text, row.size, 30 * u, 0.5, maxWidth); filters.push({ text: addText(row.text, { font: serif, size, color: "white", alpha, y: row.y - size * 0.15, riseAt: at, shadow: true }) }); }
      else if (row.kind === "detail") { const size = fitSize(row.text, row.size, 11 * u, 0.9, maxWidth); filters.push({ text: addText(row.text, { font: sans, size, color: "white@0.82", alpha, y: row.y - size * 0.15, riseAt: at, shadow: true }) }); }
      else { const size = fitSize(row.text, row.size, 11 * u, 0.5, maxWidth); filters.push({ text: addText(row.text, { font: sans, size, color: "white@0.62", alpha, y: row.y - size * 0.15, riseAt: at, shadow: true }) }); }
    });
  }

  /* ---- closing ---- */
  const closing = texts.closing;
  let closeStart = 0, textStart = 0;
  if (closing) {
    const length = Math.min(D * 0.45, 4.4);
    closeStart = D - length; textStart = closeStart + 1.0;
    const rows = [];
    if (closing.logo) rows.push({ kind: "logo", size: Math.min(height * 0.15, 110 * u) });
    if (closing.name) rows.push({ kind: "eyebrow", size: 14 * u, text: tracked("Represented by") }, { kind: "title", size: 64 * u, text: closing.name });
    if (closing.name && closing.contact) rows.push({ kind: "rule", size: Math.max(1, u) });
    if (closing.contact) rows.push({ kind: "note", size: 20 * u, text: closing.contact });
    const placed = layout(rows, width, height, u);
    placed.forEach((row, i) => {
      const at = textStart + i * 0.2;
      const alpha = smoothEnv(at, at + 0.9);
      if (row.kind === "logo") { filters.push({ logo: { y: row.y, size: row.size, at } }); return; }
      if (row.kind === "rule") { filters.push({ rule: { y: row.y, at, end: D + 1, h: row.size } }); return; }
      if (row.kind === "eyebrow") filters.push({ text: addText(row.text, { font: sans, size: row.size, color: "white@0.66", alpha, y: row.y - row.size * 0.15, riseAt: at, shadow: single }) });
      else if (row.kind === "title") { const size = fitSize(row.text, row.size, 30 * u, 0.5, maxWidth); filters.push({ text: addText(row.text, { font: serif, size, color: "white", alpha, y: row.y - size * 0.15, riseAt: at, shadow: single }) }); }
      else { const size = fitSize(row.text, row.size, 11 * u, 0.5, maxWidth); filters.push({ text: addText(row.text, { font: sans, size, color: single ? "white@0.85" : "white@0.62", alpha, y: row.y - size * 0.15, riseAt: at, shadow: single }) }); }
    });
  }

  return { texts, files, opening: Boolean(opening), closing: Boolean(closing), openingEnd, closeStart, parts: filters, u, width, height, duration: D, fps, logoData: closing?.logo || "", single };
}

/* The ffmpeg filter graph pieces for the cards, applied to `inLabel` giving `outLabel`.
   `extra` says which extra inputs exist: { vignette: index, logo: index }. `dir` is where the text files are. */
export function cardGraph(plan, inLabel, outLabel, extra, dir) {
  const { width, height, duration: D, fps, u } = plan;
  const pieces = [];
  let current = inLabel; let n = 0;
  const next = () => `cd${n++}`;
  // vignette under the opening
  const softClose = plan.single && plan.closing && extra.vignette !== undefined; // a single clip never goes dark: the agent card sits on a soft vignette
  if (softClose && plan.opening) pieces.push(`[${extra.vignette}:v]format=rgba,split=2[vgA][vgB]`);
  if (plan.opening && extra.vignette !== undefined) {
    const out = next();
    pieces.push(`${softClose && plan.opening ? "[vgA]" : `[${extra.vignette}:v]`}format=rgba,fade=t=in:st=0.5:d=1:alpha=1,fade=t=out:st=${fmt(plan.openingEnd - 0.9)}:d=0.9:alpha=1[vg${out}]`);
    pieces.push(`[${current}][vg${out}]overlay=shortest=1:format=auto[${out}]`); current = out;
  }
  if (softClose) {
    const out = next();
    pieces.push(`${plan.opening ? "[vgB]" : `[${extra.vignette}:v]`}format=rgba,fade=t=in:st=${fmt(plan.closeStart)}:d=1.2:alpha=1[vc${out}]`);
    pieces.push(`[${current}][vc${out}]overlay=shortest=1:format=auto[${out}]`); current = out;
  }
  // dim to dark under the closing (films only)
  if (plan.closing && !plan.single) {
    const out = next();
    pieces.push(`color=c=0x060607:s=${width}x${height}:r=${fps}:d=${fmt(D + 1)},format=rgba,fade=t=in:st=${fmt(plan.closeStart)}:d=1.2:alpha=1,colorchannelmixer=aa=0.95[dm${out}]`);
    pieces.push(`[${current}][dm${out}]overlay=shortest=1:format=auto[${out}]`); current = out;
  }
  for (const part of plan.parts) {
    const out = next();
    if (part.text) { pieces.push(`[${current}]${part.text.replaceAll("@@DIR@@", esc(dir))}[${out}]`); current = out; }
    else if (part.rule) {
      const r = part.rule; const w = Math.round(48 * u);
      pieces.push(`color=c=white:s=${w}x${Math.max(1, Math.round(r.h))}:r=${fps}:d=${fmt(D + 1)},format=rgba,fade=t=in:st=${fmt(r.at)}:d=0.9:alpha=1,${r.end < D ? `fade=t=out:st=${fmt(r.end - 0.9)}:d=0.9:alpha=1,` : ""}colorchannelmixer=aa=0.6[ru${out}]`);
      pieces.push(`[${current}][ru${out}]overlay=x=(W-w)/2:y=${Math.round(r.y)}:shortest=1:format=auto[${out}]`); current = out;
    } else if (part.logo && extra.logo !== undefined) {
      const l = part.logo;
      pieces.push(`[${extra.logo}:v]format=rgba,scale=-1:${Math.round(l.size)}:flags=lanczos,fade=t=in:st=${fmt(l.at)}:d=0.9:alpha=1[lg${out}]`);
      pieces.push(`[${current}][lg${out}]overlay=x=(W-w)/2:y=${Math.round(l.y)}:shortest=1:format=auto[${out}]`); current = out;
    }
  }
  pieces.push(`[${current}]null[${outLabel}]`);
  return pieces;
}

/* One frame of soft vignette (alpha only), matching the Studio preview. */
export function vignetteArgs({ width, height, output }) {
  const r0 = height * 0.3, r1 = Math.max(width, height) * 0.75;
  const a = `255*(0.18+0.44*clip((hypot(X-${width / 2},Y-${height / 2})-${fmt(r0)})/${fmt(r1 - r0)},0,1))`;
  return ["-hide_banner", "-y", "-nostdin", "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=1`, "-vf", `format=rgba,geq=r=0:g=0:b=0:a='${a}'`, "-frames:v", "1", "-update", "1", output];
}
