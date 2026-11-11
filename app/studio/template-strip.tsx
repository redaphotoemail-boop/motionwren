"use client";

/* Templates from the library, offered in Studio: pick one and the ad is
   started from it (same effects, same structure) with your own photos. Only
   templates switched on in Library Studio show. Nothing here touches a prompt. */

import { useEffect, useState } from "react";
import { LIBRARY_TEMPLATES, isLibraryTemplateVisible, parseLibraryEnabled } from "../library-templates";

export default function TemplateStrip() {
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
  return <section className="tpl-strip" aria-label="Templates">
    <div className="tpl-head"><strong>Start from a template</strong><small>Same edit, same effects, your photos.</small></div>
    <div className="tpl-row">{templates.map((item) => <a key={item.id} className="tpl-card" href={`/admin/studio-ads?template=${item.id}`}>
      <span className="tpl-meta">{item.durationSeconds} s · vertical · {item.photoSlots} photos</span>
      <strong>{item.name}</strong>
      <small>{item.blurb.split(" — ")[0]}</small>
      <em>Use this template →</em>
    </a>)}</div>
  </section>;
}
