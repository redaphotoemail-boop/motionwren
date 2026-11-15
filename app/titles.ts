/* Cinematic titles: a few typed words at the start and/or the end of a film, in one of five fonts.
   Shared by the Studio (the fields and the preview) and the server (the clean-up). Nothing is read from a reference. */
export const TITLE_FONTS = [
  { key: "cormorant", label: "Cormorant", css: "'Cormorant Garamond', Georgia, serif", note: "Light and elegant" },
  { key: "playfair", label: "Playfair", css: "'Playfair Display', Georgia, serif", note: "Classic editorial" },
  { key: "cinzel", label: "Cinzel", css: "'Cinzel', Georgia, serif", note: "Architectural capitals" },
  { key: "montserrat", label: "Montserrat", css: "'Montserrat', Helvetica, Arial, sans-serif", note: "Modern and clean" },
  { key: "bodoni", label: "Bodoni", css: "'Bodoni Moda', Georgia, serif", note: "High fashion" },
] as const;
export type TitleFontKey = (typeof TITLE_FONTS)[number]["key"];
export type TitleBlock = { text: string; sub: string };
export type FilmTitles = { font: TitleFontKey; start: TitleBlock | null; end: TitleBlock | null };

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/* What the Studio sent, trimmed to safe sizes; undefined when there is nothing to show. */
export function cleanFilmTitles(value: unknown): FilmTitles | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as { font?: unknown; start?: { text?: unknown; sub?: unknown } | null; end?: { text?: unknown; sub?: unknown } | null };
  const font = TITLE_FONTS.some((item) => item.key === input.font) ? input.font as TitleFontKey : "cormorant";
  const part = (block: { text?: unknown; sub?: unknown } | null | undefined): TitleBlock | null => { const text = clean(block?.text, 60), sub = clean(block?.sub, 80); return text || sub ? { text, sub } : null; };
  const start = part(input.start), end = part(input.end);
  return start || end ? { font, start, end } : undefined;
}
