"use client";

/* The MotionWren templates made in WrenCut, kept in the library: watch each
   with sound, switch it on or off in Studio. They are made and renamed in WrenCut. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { WrenTemplate } from "../../wrencut";
import { PreviewPlayer } from "../../wrencut-player";
import { FxChips } from "../../fx-chips";
import { socialSpec } from "../../social-templates";

export function WrenTemplates() {
  const [items, setItems] = useState<WrenTemplate[] | null>(null);
  const [watching, setWatching] = useState<WrenTemplate | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/wrencut", { cache: "no-store" });
      setItems(response.ok ? ((await response.json()) as { templates: WrenTemplate[] }).templates : []);
    } catch { setItems([]); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  async function toggle(item: WrenTemplate) {
    const response = await fetch("/api/admin/wrencut", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action: "active", active: !item.active }) });
    if (response.ok) setItems(((await response.json()) as { templates: WrenTemplate[] }).templates);
  }
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState("");
  async function updateSocial() {
    setUpdating(true); setNote("");
    try {
      const response = await fetch("/api/admin/wrencut", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "installSocial" }) });
      const data = await response.json().catch(() => ({})) as { templates?: WrenTemplate[]; added?: number; updated?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update the social templates.");
      setItems(data.templates || []);
      setNote(data.added || data.updated ? `${data.added || 0} added, ${data.updated || 0} refreshed.` : "Already up to date.");
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not update the social templates."); }
    setUpdating(false);
  }
  if (!items?.length) return null;
  const plain = items.filter((item) => !item.social), social = items.filter((item) => item.social);
  const card = (item: WrenTemplate) => {
    const spec = item.social ? socialSpec(item.social.key) : null;
    return (
      <li key={item.id} className={item.active ? "wl-card" : "wl-card off"}>
        <button type="button" className="wl-poster" aria-label={`Watch ${item.name}`} disabled={!item.previewUrl} onClick={() => setWatching(item)}>
          {item.previewUrl ? <video src={item.previewUrl} muted loop playsInline autoPlay preload="metadata" /> : <b>{Math.round(item.seconds)}<small>s</small></b>}
          {item.previewUrl ? <i aria-hidden>▶</i> : null}
        </button>
        <div className="wl-body">
          <strong>{item.name}</strong>
          <small>{item.seconds} s{item.social ? ` · ${item.social.canvas}` : ""} · {item.guide ? `${item.guide.best} photos (at least ${item.guide.least})` : `${item.photos} photos`}{item.previewUrl ? "" : " · no preview yet"}</small>
          <FxChips items={item.effects} max={6} />
          {spec ? <details className="sg-more"><summary>Guidelines for the photos</summary>
            <p>{spec.summary}</p>
            <ol>{spec.acts.map((act) => <li key={act.label}><b>{act.label}</b>{act.essential ? " (needed)" : ""}: {act.hint} <i>Camera: {act.move}.</i></li>)}</ol>
            <ul>{[...spec.rules, ...spec.avoid.map((rule) => `Avoid: ${rule}`), ...spec.approx.map((note) => `Different from the original: ${note}`)].map((rule) => <li key={rule}>{rule}</li>)}</ul>
          </details> : null}
        </div>
        <div className="wl-foot"><span>In Studio</span><button type="button" role="switch" aria-checked={item.active} aria-label={`Show ${item.name} in Studio`} className={item.active ? "ml-switch on" : "ml-switch"} onClick={() => { void toggle(item); }}><i /></button></div>
      </li>
    );
  };
  return (
    <>
      {plain.length ? <section className="panel">
        <div className="panel-head"><h2>MotionWren templates</h2><Link href="/admin/wrencut" className="muted small">Make or edit in WrenCut</Link></div>
        <p className="muted">Made from references in WrenCut. Switched on, they are suggested in Studio.</p>
        <ul className="wl-grid">{plain.map(card)}</ul>
      </section> : null}
      <section className="panel">
        <div className="panel-head"><h2>Social media</h2><button type="button" className="muted small" disabled={updating} onClick={() => { void updateSocial(); }}>{updating ? "Updating…" : "Update social templates"}</button></div>
        <p className="muted">Short, on-the-beat edits for Reels, TikTok, Shorts and YouTube. Each one tells you what photos it needs, and checks your photos in Studio. {note}</p>
        {social.length ? <ul className="wl-grid">{social.map(card)}</ul> : <p className="muted">Not installed yet. Press “Update social templates”.</p>}
      </section>
      {watching?.previewUrl ? <PreviewPlayer src={watching.previewUrl} title={watching.name} onClose={() => setWatching(null)} /> : null}
    </>
  );
}
