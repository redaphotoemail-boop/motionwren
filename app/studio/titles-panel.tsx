"use client";
import { useState } from "react";
import { TITLE_FONTS, type FilmTitles, type TitleFontKey } from "../titles";

/* Cinematic titles for a finished film: a few typed words at the start and/or the end, in one of five fonts.
   Optional and collapsed; only the words typed here are ever used. */
export type TitlesInput = { font: TitleFontKey; startText: string; startSub: string; endText: string; endSub: string };
export const emptyTitles = (): TitlesInput => ({ font: "cormorant", startText: "", startSub: "", endText: "", endSub: "" });
export const titlesFrom = (value: FilmTitles | null | undefined): TitlesInput => value ? { font: value.font, startText: value.start?.text || "", startSub: value.start?.sub || "", endText: value.end?.text || "", endSub: value.end?.sub || "" } : emptyTitles();
export const hasTitles = (value: TitlesInput) => Boolean(value.startText.trim() || value.startSub.trim() || value.endText.trim() || value.endSub.trim());
/* What is sent with the film; undefined when nothing was typed. */
export function titlesPayload(value: TitlesInput): FilmTitles | undefined {
  const block = (text: string, sub: string) => text.trim() || sub.trim() ? { text: text.trim(), sub: sub.trim() } : null;
  const start = block(value.startText, value.startSub), end = block(value.endText, value.endSub);
  return start || end ? { font: value.font, start, end } : undefined;
}

export default function TitlesPanel({ value, onChange, disabled }: { value: TitlesInput; onChange: (next: TitlesInput) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(hasTitles(value));
  const font = TITLE_FONTS.find((item) => item.key === value.font) || TITLE_FONTS[0];
  const set = (patch: Partial<TitlesInput>) => onChange({ ...value, ...patch });
  const shown = value.startText || value.startSub ? { text: value.startText, sub: value.startSub } : value.endText || value.endSub ? { text: value.endText, sub: value.endSub } : { text: "Your title", sub: "Optional second line" };
  return <details className="ttl" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary><span>Cinematic titles</span><small>{hasTitles(value) ? "On" : "Optional"}</small></summary>
    <div className="ttl-body">
      <div className="ttl-fonts" role="radiogroup" aria-label="Title font">{TITLE_FONTS.map((item) => <button type="button" role="radio" aria-checked={value.font === item.key} key={item.key} className={value.font === item.key ? "ttl-font on" : "ttl-font"} style={{ fontFamily: item.css }} disabled={disabled} onClick={() => set({ font: item.key })}>{item.label}<small>{item.note}</small></button>)}</div>
      <div className="ttl-cols">
        <div className="ttl-col"><strong>At the start</strong>
          <input value={value.startText} maxLength={60} disabled={disabled} placeholder="The Residence" onChange={(event) => set({ startText: event.target.value })} aria-label="Opening title"/>
          <input value={value.startSub} maxLength={80} disabled={disabled} placeholder="Beacon Hill, Boston" onChange={(event) => set({ startSub: event.target.value })} aria-label="Opening second line"/></div>
        <div className="ttl-col"><strong>At the end</strong>
          <input value={value.endText} maxLength={60} disabled={disabled} placeholder="Book a private viewing" onChange={(event) => set({ endText: event.target.value })} aria-label="Closing title"/>
          <input value={value.endSub} maxLength={80} disabled={disabled} placeholder="Optional second line" onChange={(event) => set({ endSub: event.target.value })} aria-label="Closing second line"/></div>
      </div>
      <div className="ttl-preview" aria-hidden><span style={{ fontFamily: font.css }}>{shown.text}</span>{shown.sub ? <em style={{ fontFamily: font.css }}>{shown.sub}</em> : null}</div>
      <p className="ttl-note">Fades in softly over the picture. The ending title leaves with the film&apos;s fade to black. Leave a side empty to skip it.</p>
    </div>
  </details>;
}
