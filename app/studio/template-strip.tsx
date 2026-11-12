"use client";

/* Templates from the library, in Studio. Switch it on, pick a template and fill
   its few fields: the scenes are made exactly as always, then the finished film
   is edited into the template (its length, cuts, text, music and look).
   Off by default. Only templates switched on in Library Studio show.
   Nothing here touches a scene prompt. */

import { useEffect, useState } from "react";
import { LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_FIELD_DEFS, emptyRestaurantInteriorFields, isLibraryTemplateVisible, libraryTemplatePlan, parseLibraryEnabled, type LibraryTemplateFields, type LibraryTemplateId } from "../library-templates";
import type { WrenTemplate } from "../wrencut";
import { wrenPlan } from "../wrencut";
import { PreviewPlayer } from "../wrencut-player";
import { engineCost, type StudioEngineKey, type StudioResolution } from "../engine-catalog";

/* id is a built-in template, or "wren:…" for a MotionWren template made in WrenCut (then `wren` holds its length and photo count). */
export type TemplatePick = { on: boolean; id: LibraryTemplateId | string; fields: LibraryTemplateFields; wren?: { seconds: number; photos: number; hasMusic?: boolean }; texts?: string[] };
export const emptyTemplatePick = (): TemplatePick => ({ on: false, id: "none", fields: emptyRestaurantInteriorFields() });

type Props = { value: TemplatePick; onChange: (next: TemplatePick) => void; engine: StudioEngineKey; resolution: StudioResolution; photoCount: number; disabled?: boolean; onEngine?: (engine: StudioEngineKey) => void };

export default function TemplateStrip({ value, onChange, engine, resolution, photoCount, disabled, onEngine }: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/library-studio", { cache: "no-store" }).then(async (response) => {
      const data = response.ok ? await response.json().catch(() => ({})) as { enabled?: unknown } : {};
      if (!cancelled) setEnabled(parseLibraryEnabled(data.enabled ?? ""));
    }).catch(() => { if (!cancelled) setEnabled({}); });
    return () => { cancelled = true; };
  }, []);
  const [wrens, setWrens] = useState<WrenTemplate[]>([]);
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/wrencut", { cache: "no-store" }).then(async (response) => {
      const data = response.ok ? await response.json().catch(() => ({})) as { templates?: WrenTemplate[] } : {};
      if (!cancelled) setWrens((data.templates || []).filter((item) => item.active));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const templates = LIBRARY_TEMPLATES.filter((item) => isLibraryTemplateVisible(item.id, enabled || {}));
  if (!enabled || (!templates.length && !wrens.length)) return null;
  const chosenWren = wrens.find((item) => item.id === value.id);
  const chosen = templates.find((item) => item.id === value.id);
  const plan = chosen && photoCount >= 2 ? libraryTemplatePlan(engine, resolution, photoCount) : null;
  const wrenCost = chosenWren && photoCount >= 2 ? (() => { const wp = wrenPlan(engine, resolution, photoCount, chosenWren.seconds); return { count: wp.count, cost: engineCost(engine, wp.resolution, wp.sceneSeconds * wp.count) }; })() : null;
  const cost = plan ? engineCost(engine, plan.resolution, plan.sceneSeconds * plan.count) : null;
  const pickWren = (item: WrenTemplate) => { if (item.engine && onEngine) onEngine(item.engine as StudioEngineKey); onChange({ ...value, id: item.id, wren: { seconds: item.seconds, photos: item.photos, hasMusic: item.hasMusic }, texts: [] }); };
  const pickBuiltIn = (id: string) => onChange({ ...value, id, wren: undefined });
  const toggle = () => {
    const on = !value.on;
    if (on && value.id === "none") { if (templates.length) onChange({ ...value, on, id: templates[0].id, wren: undefined }); else { if (wrens[0].engine && onEngine) onEngine(wrens[0].engine as StudioEngineKey); onChange({ ...value, on, id: wrens[0].id, wren: { seconds: wrens[0].seconds, photos: wrens[0].photos, hasMusic: wrens[0].hasMusic } }); } return; }
    onChange({ ...value, on });
  };
  return <section className="tpl-strip" aria-label="Template">
    <div className="tpl-top">
      <div className="tpl-head"><strong>Use a template</strong><small>Your film is made, then edited into the template. Off by default.</small></div>
      <button type="button" role="switch" aria-checked={value.on} aria-label="Use a template" className={value.on ? "ml-switch on" : "ml-switch"} disabled={disabled} onClick={toggle}><i/></button>
    </div>
    {value.on && <>
      <div className="tpl-grid" role="radiogroup" aria-label="Templates">{templates.map((item) => <button type="button" role="radio" aria-checked={value.id === item.id} key={item.id} className={value.id === item.id ? "tpl-tile active" : "tpl-tile"} onClick={() => pickBuiltIn(item.id)} disabled={disabled}>
        <span className="tpl-poster" aria-hidden>{item.previewUrl ? <video src={item.previewUrl} muted loop playsInline autoPlay preload="metadata"/> : <b>{item.durationSeconds}<small>s</small></b>}</span>
        <strong>{item.name}</strong>
        <small>{item.photoSlots} photos · vertical</small>
      </button>)}{wrens.map((item) => <button type="button" role="radio" aria-checked={value.id === item.id} key={item.id} className={value.id === item.id ? "tpl-tile active" : "tpl-tile"} onClick={() => pickWren(item)} disabled={disabled}>
        <span className="tpl-poster" aria-hidden>{item.previewUrl ? <video src={item.previewUrl} muted loop playsInline autoPlay preload="metadata"/> : <b>{Math.round(item.seconds)}<small>s</small></b>}</span>
        <strong>{item.name}</strong>
        <small>{item.photos} photos</small>
      </button>)}</div>
      {watching && chosenWren?.previewUrl ? <PreviewPlayer src={chosenWren.previewUrl} title={chosenWren.name} onClose={() => setWatching(false)} /> : null}
      {chosenWren && <div className="tpl-fields">
        <p className="tpl-summary"><strong>{chosenWren.name}</strong> · {chosenWren.seconds} s · built for {chosenWren.photos} photos{chosenWren.hasMusic || chosenWren.hasEffects ? " · music and effects matched" : ""}{wrenCost ? ` · uses ${wrenCost.count} of your photos · engine cost about $${wrenCost.cost.toFixed(2)}` : ""}</p>
        {chosenWren.previewUrl ? <button type="button" className="wc-watch" onClick={() => setWatching(true)}>Watch full screen with sound</button> : null}
      </div>}
      {chosen && <div className="tpl-fields">
        <p className="tpl-summary"><strong>{chosen.name}</strong> · {chosen.durationSeconds} s vertical · hard cuts · up to {chosen.photoSlots} photos{plan ? ` · uses ${plan.count} of your photos` : ""}{cost !== null ? ` · engine cost about $${cost.toFixed(2)}` : ""}</p>
        {LIBRARY_TEMPLATE_FIELD_DEFS.map((def) => <label key={def.key} className="tpl-field"><span>{def.label}</span><input value={value.fields[def.key]} maxLength={def.maxLength} placeholder={def.placeholder} disabled={disabled} onChange={(event) => onChange({ ...value, fields: { ...value.fields, [def.key]: event.target.value } })}/></label>)}
      </div>}
    </>}
  </section>;
}
