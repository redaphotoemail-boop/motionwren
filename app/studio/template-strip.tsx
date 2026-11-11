"use client";

/* Templates from the library, in Studio. Switch it on, pick a template and fill
   its few fields: the scenes are made exactly as always, then the finished film
   is edited into the template (its length, cuts, text, music and look).
   Off by default. Only templates switched on in Library Studio show.
   Nothing here touches a scene prompt. */

import { useEffect, useState } from "react";
import { LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_FIELD_DEFS, emptyRestaurantInteriorFields, isLibraryTemplateVisible, libraryTemplatePlan, parseLibraryEnabled, type LibraryTemplateFields, type LibraryTemplateId } from "../library-templates";
import { engineCost, type StudioEngineKey, type StudioResolution } from "../engine-catalog";

export type TemplatePick = { on: boolean; id: LibraryTemplateId; fields: LibraryTemplateFields };
export const emptyTemplatePick = (): TemplatePick => ({ on: false, id: "none", fields: emptyRestaurantInteriorFields() });

type Props = { value: TemplatePick; onChange: (next: TemplatePick) => void; engine: StudioEngineKey; resolution: StudioResolution; photoCount: number; disabled?: boolean };

export default function TemplateStrip({ value, onChange, engine, resolution, photoCount, disabled }: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/library-studio", { cache: "no-store" }).then(async (response) => {
      const data = response.ok ? await response.json().catch(() => ({})) as { enabled?: unknown } : {};
      if (!cancelled) setEnabled(parseLibraryEnabled(data.enabled ?? ""));
    }).catch(() => { if (!cancelled) setEnabled({}); });
    return () => { cancelled = true; };
  }, []);
  const templates = LIBRARY_TEMPLATES.filter((item) => isLibraryTemplateVisible(item.id, enabled || {}));
  if (!enabled || !templates.length) return null;
  const chosen = templates.find((item) => item.id === value.id);
  const plan = chosen && photoCount >= 2 ? libraryTemplatePlan(engine, resolution, photoCount) : null;
  const cost = plan ? engineCost(engine, plan.resolution, plan.sceneSeconds * plan.count) : null;
  const toggle = () => {
    const on = !value.on;
    onChange({ ...value, on, id: on ? (value.id !== "none" ? value.id : templates[0].id) : value.id });
  };
  return <section className="tpl-strip" aria-label="Template">
    <div className="tpl-top">
      <div className="tpl-head"><strong>Use a template</strong><small>Your film is made, then edited into the template. Off by default.</small></div>
      <button type="button" role="switch" aria-checked={value.on} aria-label="Use a template" className={value.on ? "ml-switch on" : "ml-switch"} disabled={disabled} onClick={toggle}><i/></button>
    </div>
    {value.on && <>
      {templates.length > 1 && <div className="tpl-row">{templates.map((item) => <button type="button" key={item.id} className={value.id === item.id ? "tpl-card active" : "tpl-card"} onClick={() => onChange({ ...value, id: item.id })} disabled={disabled}><span className="tpl-meta">{item.durationSeconds} s · vertical · up to {item.photoSlots} photos</span><strong>{item.name}</strong></button>)}</div>}
      {chosen && <div className="tpl-fields">
        <p className="tpl-summary"><strong>{chosen.name}</strong> · {chosen.durationSeconds} s vertical · hard cuts · up to {chosen.photoSlots} photos{plan ? ` · uses ${plan.count} of your photos` : ""}{cost !== null ? ` · engine cost about $${cost.toFixed(2)}` : ""}</p>
        {LIBRARY_TEMPLATE_FIELD_DEFS.map((def) => <label key={def.key} className="tpl-field"><span>{def.label}</span><input value={value.fields[def.key]} maxLength={def.maxLength} placeholder={def.placeholder} disabled={disabled} onChange={(event) => onChange({ ...value, fields: { ...value.fields, [def.key]: event.target.value } })}/></label>)}
      </div>}
    </>}
  </section>;
}
