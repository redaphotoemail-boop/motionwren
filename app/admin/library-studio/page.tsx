"use client";

/* Library Studio — admin only. Recorded video templates: switch one on
   and it appears as a choice when producing a Studio Ad. Off stays
   hidden. The page lives under /admin so the existing admin layout gate
   covers it. */

import { useCallback, useEffect, useState } from "react";
import { LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_FIELD_DEFS, isLibraryTemplateVisible, parseLibraryEnabled } from "../../library-templates";
import { PageHead } from "../ui";

export default function LibraryStudioPage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/library-studio", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setEnabled(parseLibraryEnabled(data.enabled ?? ""));
      }
    } catch { /* A failed load leaves every template visible, as before. */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  async function toggle(id: string, next: boolean) {
    const template = LIBRARY_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/library-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled: next }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The setting could not be saved.");
      await load();
      setMessage(next ? `"${template.name}" will show when producing a Studio Ad.` : `"${template.name}" is hidden when producing a Studio Ad.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The setting could not be saved."); }
    finally { setSaving(false); }
  }

  return (
    <div className="mgr-page">
      <PageHead eyebrow="Manager · Admin only" title="Library Studio" sub="Recorded video templates — switch one on and it appears as a choice when producing a Studio Ad. Off stays hidden." />
      {message ? <p className="notice">{message}</p> : null}
      <div className="mgr-stack">
        {LIBRARY_TEMPLATES.map((template) => (
          <section key={template.id} className="panel">
            <div className="panel-head"><h2>{template.name}</h2><span className="muted small">{template.source}</span></div>
            <p className="muted">{template.blurb}</p>
            <p className="muted small">{template.durationSeconds} s · vertical 9:16 · {template.photoSlots} photo slots · hard cuts · warm grade · Luxe &amp; warm music</p>
            <p className="muted small">Fields: {LIBRARY_TEMPLATE_FIELD_DEFS.map((def) => def.label).join(", ")}</p>
            <label className="field-toggle">
              <input type="checkbox" checked={isLibraryTemplateVisible(template.id, enabled)} disabled={saving || !loaded} onChange={(event) => { void toggle(template.id, event.target.checked); }} />
              Show when producing
            </label>
          </section>
        ))}
        {!LIBRARY_TEMPLATES.length && loaded ? <p className="muted">No templates recorded yet.</p> : null}
      </div>
    </div>
  );
}
