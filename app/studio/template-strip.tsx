"use client";

/* Templates from the library, in Studio. Switch it on, pick a template and fill
   its few fields: the scenes are made exactly as always, then the finished film
   is edited into the template (its length, cuts, text, music and look).
   Off by default. Only templates switched on in Library Studio show.
   Nothing here touches a scene prompt. */

import { FxChips } from "../fx-chips";
import { useEffect, useState } from "react";
import { LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_FIELD_DEFS, emptyRestaurantInteriorFields, isLibraryTemplateVisible, libraryTemplatePlan, parseLibraryEnabled, type LibraryTemplateFields, type LibraryTemplateId } from "../library-templates";
import type { WrenTemplate } from "../wrencut";
import { wrenPlan } from "../wrencut";
import { socialPlan, socialSpec } from "../social-templates";
import SocialGuide, { type SocialPhoto } from "./social-guide";
import { PreviewPlayer } from "../wrencut-player";
import { engineCost, studioEngine, type StudioEngineKey, type StudioResolution } from "../engine-catalog";

/* id is a built-in template, or "wren:…" for a MotionWren template made in WrenCut (then `wren` holds its length and photo count). */
export type TemplatePick = { on: boolean; id: LibraryTemplateId | string; fields: LibraryTemplateFields; wren?: { seconds: number; photos: number; best?: number; least?: number; hasMusic?: boolean; social?: string }; texts?: string[] };
export const emptyTemplatePick = (): TemplatePick => ({ on: false, id: "none", fields: emptyRestaurantInteriorFields() });

type Props = { value: TemplatePick; onChange: (next: TemplatePick) => void; engine: StudioEngineKey; resolution: StudioResolution; photoCount: number; disabled?: boolean; onEngine?: (engine: StudioEngineKey) => void; photos?: SocialPhoto[]; onFrame?: (frame: "vertical" | "horizontal" | "cinematic") => void; onArrange?: (order: number[]) => void };

export default function TemplateStrip({ value, onChange, engine, resolution, photoCount, disabled, onEngine, photos = [], onFrame, onArrange }: Props) {
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
  const [tabPick, setTab] = useState<"listing" | "social" | null>(null);
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
  const hasSocial = wrens.some((item) => item.social);
  const chosenWren = wrens.find((item) => item.id === value.id);
  const tab = tabPick || (chosenWren?.social ? "social" : "listing"); // follows the chosen template until the tab is tapped
  const chosen = templates.find((item) => item.id === value.id);
  const plan = chosen && photoCount >= 2 ? libraryTemplatePlan(engine, resolution, photoCount) : null;
  const chosenSocial = chosenWren?.social ? socialSpec(chosenWren.social.key) : null;
  const wrenCost = chosenWren && photoCount >= 2 ? (() => { const sp = chosenSocial ? socialPlan(chosenSocial, photoCount) : null; const wp = sp ? wrenPlan(engine, resolution, sp.count, sp.seconds, sp.minScene) : wrenPlan(engine, resolution, photoCount, chosenWren.seconds); return { count: wp.count, cost: engineCost(engine, wp.resolution, wp.sceneSeconds * wp.count) }; })() : null;
  const cost = plan ? engineCost(engine, plan.resolution, plan.sceneSeconds * plan.count) : null;
  const wrenOf = (item: WrenTemplate) => ({ seconds: item.seconds, photos: item.photos, best: item.guide?.best, least: item.guide?.least, hasMusic: item.hasMusic, ...(item.social ? { social: item.social.key } : {}) });
  const pickWren = (item: WrenTemplate) => { if (item.engine && onEngine) onEngine(item.engine as StudioEngineKey); if (item.social && onFrame) onFrame(item.social.frame); onChange({ ...value, id: item.id, wren: wrenOf(item), texts: [] }); };
  const pickBuiltIn = (id: string) => onChange({ ...value, id, wren: undefined });
  const toggle = () => {
    const on = !value.on;
    if (on && value.id === "none") { if (templates.length) onChange({ ...value, on, id: templates[0].id, wren: undefined }); else { const first = wrens.find((item) => !item.social) || wrens[0]; if (first.engine && onEngine) onEngine(first.engine as StudioEngineKey); if (first.social && onFrame) onFrame(first.social.frame); onChange({ ...value, on, id: first.id, wren: { seconds: first.seconds, photos: first.photos, hasMusic: first.hasMusic, ...(first.social ? { social: first.social.key } : {}) } }); } return; }
    onChange({ ...value, on });
  };
  const renderWren = (item: WrenTemplate) => (
    <button type="button" role="radio" aria-checked={value.id === item.id} key={item.id} className={value.id === item.id ? "tpl-tile active" : "tpl-tile"} onClick={() => pickWren(item)} disabled={disabled}>
        <span className="tpl-poster" aria-hidden>{item.previewUrl ? <video src={item.previewUrl} muted loop playsInline autoPlay preload="metadata"/> : <b>{Math.round(item.seconds)}<small>s</small></b>}</span>
        <strong>{item.name}</strong>
        <small>{item.guide ? `Best with ${item.guide.best} photos · at least ${item.guide.least}` : `${item.photos} photos`}</small>
        <FxChips items={item.effects} />
      </button>
  );
  return <section className="tpl-strip" aria-label="Template">
    <div className="tpl-top">
      <div className="tpl-head"><strong>Use a template</strong><small>Your film is made, then edited into the template. Off by default.</small></div>
      <button type="button" role="switch" aria-checked={value.on} aria-label="Use a template" className={value.on ? "ml-switch on" : "ml-switch"} disabled={disabled} onClick={toggle}><i/></button>
    </div>
    {value.on && <>
      {hasSocial ? <div className="tpl-tabs" role="tablist" aria-label="Template type"><button type="button" role="tab" aria-selected={tab === "listing"} onClick={() => setTab("listing")}>Listing films</button><button type="button" role="tab" aria-selected={tab === "social"} onClick={() => setTab("social")}>Social media</button></div> : null}
      <div className="tpl-rail" role="radiogroup" aria-label="Templates" hidden={Boolean(hasSocial) && tab !== "listing"}>{templates.map((item) => <button type="button" role="radio" aria-checked={value.id === item.id} key={item.id} className={value.id === item.id ? "tpl-tile active" : "tpl-tile"} onClick={() => pickBuiltIn(item.id)} disabled={disabled}>
        <span className="tpl-poster" aria-hidden>{item.previewUrl ? <video src={item.previewUrl} muted loop playsInline autoPlay preload="metadata"/> : <b>{item.durationSeconds}<small>s</small></b>}</span>
        <strong>{item.name}</strong>
        <small>{item.photoSlots} photos · vertical</small>
      </button>)}{wrens.filter((item) => !item.social).map(renderWren)}</div>
      {hasSocial ? <div className="tpl-rail" role="radiogroup" aria-label="Social media templates" hidden={tab !== "social"}>{wrens.filter((item) => item.social).map(renderWren)}</div> : null}
      {hasSocial && tab === "social" ? <small className="tpl-hint">Short, on-the-beat edits for Reels, TikTok, Shorts and YouTube. Each tells you what photos it needs, then checks yours.</small> : null}
      {watching && chosenWren?.previewUrl ? <PreviewPlayer src={chosenWren.previewUrl} title={chosenWren.name} onClose={() => setWatching(false)} /> : null}
      {chosenWren && <div className="tpl-fields">
        {studioEngine(engine).photoMove ? <p className="notice">This template needs a video engine. Photo move only slides across a still photo, so the film would look like photos. Choose another engine above.</p> : null}
        {(() => { const best = chosenWren.guide?.best ?? chosenWren.photos, least = chosenWren.guide?.least ?? 2, ok = photoCount >= least; return <p className={ok ? "tpl-need ok" : "tpl-need"}><strong>Requirements: {best} photos for the best result{least < best ? ` (at least ${least})` : ""}.</strong> {ok ? `You have ${photoCount}${photoCount >= best ? " — complete." : ` — ${best - photoCount} more makes it complete.`}` : `You have ${photoCount} — add ${least - photoCount} more before you can make this film.`}</p>; })()}
        <p className="tpl-summary"><strong>{chosenWren.name}</strong> · {chosenWren.seconds} s · built for {chosenWren.photos} photos{chosenWren.hasMusic || chosenWren.hasEffects ? " · music and effects matched" : ""}{wrenCost ? ` · uses ${wrenCost.count} of your photos · engine cost about $${wrenCost.cost.toFixed(2)}` : ""}</p>
        {chosenWren.previewUrl ? <button type="button" className="wc-watch" onClick={() => setWatching(true)}>Watch full screen with sound</button> : null}
        {chosenSocial ? <SocialGuide spec={chosenSocial} photos={photos} engine={engine} resolution={resolution} onArrange={onArrange} disabled={disabled} /> : null}
      </div>}
      {chosen && <div className="tpl-fields">
        <p className="tpl-summary"><strong>{chosen.name}</strong> · {chosen.durationSeconds} s vertical · hard cuts · up to {chosen.photoSlots} photos{plan ? ` · uses ${plan.count} of your photos` : ""}{cost !== null ? ` · engine cost about $${cost.toFixed(2)}` : ""}</p>
        {LIBRARY_TEMPLATE_FIELD_DEFS.map((def) => <label key={def.key} className="tpl-field"><span>{def.label}</span><input value={value.fields[def.key]} maxLength={def.maxLength} placeholder={def.placeholder} disabled={disabled} onChange={(event) => onChange({ ...value, fields: { ...value.fields, [def.key]: event.target.value } })}/></label>)}
      </div>}
    </>}
  </section>;
}
