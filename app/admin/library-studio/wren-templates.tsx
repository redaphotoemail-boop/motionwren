"use client";

/* The MotionWren templates made in WrenCut, kept in the library: watch each
   with sound, switch it on or off in Studio. They are made and renamed in WrenCut. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { WrenTemplate } from "../../wrencut";
import { PreviewPlayer } from "../../wrencut-player";

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
  if (!items?.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>MotionWren templates</h2><Link href="/admin/wrencut" className="muted small">Make or edit in WrenCut</Link></div>
      <p className="muted">Made from references in WrenCut. Switched on, they are suggested in Studio.</p>
      <ul className="ml-tracks">
        {items.map((item) => (
          <li key={item.id} className={item.active ? "" : "off"}>
            <button type="button" className="ml-play" aria-label={`Watch ${item.name}`} disabled={!item.previewUrl} onClick={() => setWatching(item)}>▶</button>
            <span className="ml-name"><strong>{item.name}</strong><small>{item.seconds} s · {item.photos} photos{item.hasMusic ? " · music" : ""}{item.hasEffects ? " · effects" : ""}{item.previewUrl ? "" : " · no preview yet"}</small></span>
            <button type="button" role="switch" aria-checked={item.active} aria-label={`Show ${item.name} in Studio`} className={item.active ? "ml-switch on" : "ml-switch"} onClick={() => { void toggle(item); }}><i /></button>
          </li>
        ))}
      </ul>
      {watching?.previewUrl ? <PreviewPlayer src={watching.previewUrl} title={watching.name} onClose={() => setWatching(null)} /> : null}
    </section>
  );
}
